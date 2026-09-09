import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { atomic, consent, identify, json, record, shop, Tx } from "./store";
import { date, DAY } from "./rules";
import { enroll } from "./flows";

type Customer = {
  id?: string | number;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  tags?: string | string[];
  updated_at?: string;
  email_marketing_consent?: {
    state: string | null;
    consent_updated_at?: string | null;
  };
  sms_marketing_consent?: {
    state: string | null;
    consent_updated_at?: string | null;
  };
};
type Payload = Customer & {
  customer?: Customer;
  customerId?: string | number;
  customer_id?: string | number;
  email_address?: string;
  occurredAt?: string;
  created_at?: string;
  total_price?: string;
  currency?: string;
  test?: boolean;
  order_id?: string | number;
  expected_delivery_at?: string;
  abandoned_checkout_url?: string;
  financial_status?: string;
  checkout_token?: string;
  token?: string;
  shopify_current_tags?: string[];
};

function isCustomerTagTopic(topic: string) {
  return [
    "customer.tags_added",
    "customer.tags_removed",
    "customers/tags_added",
    "customers/tags_removed",
  ].includes(topic);
}

function isCustomerConsentTopic(topic: string) {
  return [
    "customers_email_marketing_consent/update",
    "customers_marketing_consent/update",
  ].includes(topic);
}

function customerIdFromTagPayload(p: Payload) {
  const id = String(p.customerId || p.customer_id || p.id || "");
  return id.replace(/^gid:\/\/shopify\/Customer\//, "");
}

function webhookTags(value: Customer["tags"]) {
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

type ShopifyCustomerLookup = {
  data?: {
    customer?: {
      id: string;
      legacyResourceId?: string | null;
      email?: string | null;
      phone?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      tags?: string[];
      emailMarketingConsent?: {
        marketingState?: string | null;
        consentUpdatedAt?: string | null;
      } | null;
      smsMarketingConsent?: {
        marketingState?: string | null;
        consentUpdatedAt?: string | null;
      } | null;
    } | null;
  };
};

const SHOPIFY_CUSTOMER_LOOKUP = `
  query MarketingCustomer($id: ID!) {
    customer(id: $id) {
      id
      legacyResourceId
      email
      phone
      firstName
      lastName
      tags
      emailMarketingConsent { marketingState consentUpdatedAt }
      smsMarketingConsent { marketingState consentUpdatedAt }
    }
  }
`;

/**
 * Shopify's dedicated customer tag webhook contains the customer ID and a
 * tag delta, but it is not a reliable source for identity or consent. Always
 * hydrate the current customer so a tag change also refreshes consent that
 * may have been set before marketing webhooks were connected.
 */
async function hydrateCustomerTagPayload(
  topic: string,
  p: Payload,
): Promise<Payload> {
  if (!isCustomerTagTopic(topic)) return p;
  const id = customerIdFromTagPayload(p);
  if (!id) throw new Error("Shopify customer tag event is missing customerId.");

  try {
    const result = await shopifyGraphql<ShopifyCustomerLookup>(
      SHOPIFY_CUSTOMER_LOOKUP,
      { id: `gid://shopify/Customer/${id}` },
    );
    const c = result.data?.customer;
    if (!c)
      throw new Error("Shopify customer could not be loaded; retry required.");
    const normalizeConsent = (
      value:
        | { marketingState?: string | null; consentUpdatedAt?: string | null }
        | null
        | undefined,
    ) =>
      value?.marketingState
        ? {
            state: value.marketingState.toLowerCase(),
            consent_updated_at: value.consentUpdatedAt || undefined,
          }
        : undefined;
    return {
      ...p,
      id: c.legacyResourceId || id,
      email: c.email || undefined,
      phone: c.phone || undefined,
      first_name: c.firstName || undefined,
      last_name: c.lastName || undefined,
      email_marketing_consent: normalizeConsent(c.emailMarketingConsent),
      sms_marketing_consent: normalizeConsent(c.smsMarketingConsent),
      shopify_current_tags: c.tags || undefined,
    };
  } catch (error) {
    // Do not acknowledge partial tag updates: the inbox retries hydration.
    throw new Error(
      "Could not hydrate Shopify customer tag event: " +
        (error instanceof Error ? error.message : "lookup failed"),
    );
  }
}
async function attribute(tx: Tx, profileId: string, at: Date) {
  for (const [type, window] of [
    ["CLICKED", 5 * DAY],
    ["OPENED", DAY],
  ] as const) {
    const event = await tx.marketingEvent.findFirst({
      where: {
        shop: shop(),
        profileId,
        type,
        messageId: { not: null },
        occurredAt: { gte: new Date(+at - window), lte: at },
      },
      orderBy: { occurredAt: "desc" },
    });
    if (event) return event.messageId!;
  }
  return undefined;
}
export async function ingestShopify(
  topic: string,
  key: string,
  p: Payload,
  historical = false,
) {
  p = await hydrateCustomerTagPayload(topic, p);
  return atomic(async (tx) => {
    if (
      await tx.marketingEvent.findUnique({
        where: { shop_key: { shop: shop(), key } },
      })
    )
      return { duplicate: true };
    const tagTopic = isCustomerTagTopic(topic);
    const consentTopic = isCustomerConsentTopic(topic);
    const c = tagTopic
      ? p
      : consentTopic
        ? { ...p, id: p.customer_id || p.id, email: p.email_address || p.email }
        : topic.startsWith("customers/")
          ? p
          : p.customer || {};
    if (
      topic.startsWith("checkouts/") &&
      !(c.email || p.email || c.phone || p.phone || c.id)
    ) {
      await record(tx, {
        key,
        type: "CHECKOUT_UNIDENTIFIED",
        payload: { checkoutId: String(p.id || p.token || "") },
      });
      return { skipped: true };
    }
    const profile = await identify(tx, {
      email: c.email || p.email,
      phone: c.phone || p.phone,
      shopifyId: c.id ? String(c.id) : undefined,
      name: [c.first_name, c.last_name].filter(Boolean).join(" "),
    });
    const at = date(
      p.updated_at ||
        p.created_at ||
        p.occurredAt ||
        p.email_marketing_consent?.consent_updated_at ||
        p.sms_marketing_consent?.consent_updated_at ||
        new Date().toISOString(),
    );
    if (at > new Date(Date.now() + 300000))
      throw new Error("Future event timestamp rejected.");
    await record(tx, {
      key,
      type: topic,
      profileId: profile.id,
      occurredAt: at,
      payload: p,
    });
    if (topic.startsWith("customers/") || tagTopic) {
      const incomingTags = webhookTags(p.tags);
      const removedTags =
        tagTopic && topic.endsWith("tags_removed")
          ? new Set(incomingTags)
          : new Set<string>();
      const currentShopifyTags =
        tagTopic && Array.isArray(p.shopify_current_tags)
          ? webhookTags(p.shopify_current_tags)
          : null;
      // Full customer payloads are authoritative. Dedicated tag events are
      // deltas, so merge or remove only the tags named in the event.
      const tags = tagTopic
        ? currentShopifyTags || [
            ...new Set(
              topic.endsWith("tags_removed")
                ? profile.tags.filter((t) => !removedTags.has(t))
                : [...profile.tags, ...incomingTags],
            ),
          ]
        : p.tags == null
          ? profile.tags
          : incomingTags;
      // Full customer payloads are authoritative and use the timestamp guard.
      // Tag webhooks are deltas; a neighboring customers/update event must not
      // erase them because newer Shopify payloads intentionally omit tags.
      const newer = tagTopic
        ? null
        : await tx.marketingEvent.findFirst({
            where: {
              profileId: profile.id,
              type: {
                in: [
                  "customers/create",
                  "customers/update",
                  "customer.tags_added",
                  "customer.tags_removed",
                  "customers/tags_added",
                  "customers/tags_removed",
                ],
              },
              occurredAt: { gt: at },
            },
          });
      if (!newer) {
        await tx.marketingProfile.update({
          where: { id: profile.id },
          data: { tags },
        });
        const b2bAdded =
          tagTopic &&
          topic.endsWith("tags_added") &&
          incomingTags.includes("b2b");
        if (
          !historical &&
          tags.includes("b2b") &&
          (!profile.tags.includes("b2b") || b2bAdded) &&
          !topic.endsWith("tags_removed")
        )
          await enroll(tx, "b2b-welcome", profile.id, key, at);
      }
    }
    for (const [channel, value] of [
      ["EMAIL", c.email_marketing_consent],
      ["SMS_MARKETING", c.sms_marketing_consent],
    ] as const) {
      if (value)
        await consent(
          tx,
          profile.id,
          channel,
          value.state === "subscribed"
            ? "SUBSCRIBED"
            : value.state === "unsubscribed"
              ? "UNSUBSCRIBED"
              : "NEVER_SUBSCRIBED",
          "shopify",
          date(value.consent_updated_at || at.toISOString()),
        );
    }
    // If consent arrived after the tag event, resume only an existing enrollment.
    // Imported B2B profiles without a tag-triggered message are never enrolled here.
    if (
      consentTopic &&
      c.email_marketing_consent?.state === "subscribed" &&
      profile.tags.includes("b2b") &&
      (await tx.marketingMessage.findFirst({
        where: {
          profileId: profile.id,
          flowKey: "b2b-welcome",
          status: "CANCELLED",
          error: "Not eligible for this channel",
        },
      }))
    ) {
      await enroll(tx, "b2b-welcome", profile.id, key, at);
    }
    if (topic === "orders/create" && !p.test) {
      const orderKey = `order:${p.id}`;
      if (
        !(await tx.marketingEvent.findUnique({
          where: { shop_key: { shop: shop(), key: orderKey } },
        }))
      ) {
        const orderAt = date(p.created_at || at.toISOString());
        await record(tx, {
          key: orderKey,
          type: "ORDER",
          profileId: profile.id,
          messageId: historical
            ? undefined
            : await attribute(tx, profile.id, orderAt),
          occurredAt: orderAt,
          payload: {
            orderId: String(p.id),
            revenue: String(p.total_price || "0"),
            currency: p.currency || "UNKNOWN",
            model: "last-click-5d-else-open-1d",
            historical,
          },
        });
        if (!profile.lastOrderAt || profile.lastOrderAt < orderAt)
          await tx.marketingProfile.update({
            where: { id: profile.id },
            data: { lastOrderAt: orderAt },
          });
        await tx.marketingMessage.updateMany({
          where: {
            profileId: profile.id,
            flowKey: "abandoned-cart",
            status: "PENDING",
            triggerAt: { lte: orderAt },
          },
          data: { status: "CANCELLED", error: "Order placed" },
        });
      }
    }
    if (
      ["checkouts/create", "checkouts/update"].includes(topic) &&
      !historical &&
      p.abandoned_checkout_url
    )
      await enroll(
        tx,
        "abandoned-cart",
        profile.id,
        String(p.token || p.id),
        date(p.created_at || at.toISOString()),
        { url: p.abandoned_checkout_url },
      );
    if (topic === "delivery/scheduled" && !historical && p.expected_delivery_at)
      await enroll(
        tx,
        "delivery-upsell",
        profile.id,
        String(p.order_id || p.id),
        at,
        { expectedDeliveryAt: date(p.expected_delivery_at) },
      );
    return { profileId: profile.id };
  });
}

export async function deliveryEvent(
  key: string,
  providerId: string,
  type: string,
  at: Date,
  payload: unknown = {},
) {
  const allowed = [
    "DELIVERED",
    "OPENED",
    "CLICKED",
    "BOUNCED",
    "COMPLAINED",
    "UNSUBSCRIBED",
    "FAILED",
    "SMS_RECEIVED",
  ];
  if (!allowed.includes(type)) return;
  return atomic(async (tx) => {
    const m = await tx.marketingMessage.findFirst({
      where: { providerId, shop: shop() },
    });
    if (!m) {
      // Internal test sends are delivered through the provider without a
      // MarketingMessage/profile row. Resolve their provider ID mapping so
      // Resend can receive a successful response instead of retrying forever.
      const test = await tx.marketingEvent.findUnique({
        where: {
          shop_key: { shop: shop(), key: `test-provider:${providerId}` },
        },
      });
      if (!test) throw new Error("Message not recorded yet; retry event.");
      await record(tx, {
        key,
        type,
        occurredAt: at,
        payload: { ...((payload || {}) as object), test: true, providerId },
      });
      return;
    }
    if (at > new Date(Date.now() + 300000))
      throw new Error("Invalid event time.");
    await record(tx, {
      key,
      type,
      profileId: m.profileId,
      messageId: m.id,
      occurredAt: at,
      payload,
    });
    if (type === "OPENED" && m.channel === "EMAIL")
      await tx.marketingProfile.updateMany({
        where: {
          id: m.profileId,
          OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lt: at } }],
        },
        data: { lastOpenedAt: at },
      });
    if (["BOUNCED", "COMPLAINED", "UNSUBSCRIBED"].includes(type))
      await consent(
        tx,
        m.profileId,
        m.channel as "EMAIL" | "SMS_MARKETING" | "SMS_TRANSACTIONAL",
        "UNSUBSCRIBED",
        "provider",
        at,
        type,
      );
  });
}

export type ImportRow = {
  email?: string;
  phone?: string;
  shopifyId?: string;
  name?: string;
  emailStatus?: string;
  smsStatus?: string;
  smsTransactionalStatus?: string;
  emailSuppressed?: boolean;
  smsSuppressed?: boolean;
  consentAt?: string;
  consentSource?: string;
  emailConsentAt?: string;
  smsConsentAt?: string;
  smsTransactionalConsentAt?: string;
  emailConsentSource?: string;
  smsConsentSource?: string;
  lastOpenedAt?: string;
  lastOrderAt?: string;
  lists?: string[];
  tags?: string[];
  timezone?: string;
};
export async function importProfiles(rows: ImportRow[], dryRun: boolean) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500)
    throw new Error("Import 1–500 rows per batch.");
  const results: { row: number; status: string; error?: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await atomic(async (tx) => {
        const row = rows[i];
        const p = await identify(tx, row);
        for (const [channel, status, suppressed, timestamp, source] of [
          [
            "EMAIL",
            row.emailStatus,
            row.emailSuppressed,
            row.emailConsentAt || row.consentAt,
            row.emailConsentSource || row.consentSource,
          ],
          [
            "SMS_MARKETING",
            row.smsStatus,
            row.smsSuppressed,
            row.smsConsentAt || row.consentAt,
            row.smsConsentSource || row.consentSource,
          ],
          [
            "SMS_TRANSACTIONAL",
            row.smsTransactionalStatus,
            row.smsSuppressed,
            row.smsTransactionalConsentAt,
            row.smsConsentSource || row.consentSource,
          ],
        ] as const) {
          if (status || suppressed) {
            if (status === "SUBSCRIBED" && (!timestamp || !source))
              throw new Error(
                "Subscribed imports require channel consent timestamp and source.",
              );
            if (timestamp && date(timestamp) > new Date())
              throw new Error("Consent cannot be in the future.");
            if (suppressed != null && typeof suppressed !== "boolean")
              throw new Error("Suppression fields must be true or false.");
            await consent(
              tx,
              p.id,
              channel,
              suppressed ? "UNSUBSCRIBED" : status || "NEVER_SUBSCRIBED",
              source || "klaviyo-import",
              timestamp ? date(timestamp) : new Date(),
              suppressed ? "Imported suppression" : undefined,
            );
          }
        }
        const opened = row.lastOpenedAt ? date(row.lastOpenedAt) : null,
          ordered = row.lastOrderAt ? date(row.lastOrderAt) : null;
        if (
          (opened && opened > new Date()) ||
          (ordered && ordered > new Date())
        )
          throw new Error("Historical engagement cannot be in the future.");
        if (row.timezone)
          new Intl.DateTimeFormat("en", { timeZone: row.timezone }).format();
        await tx.marketingProfile.update({
          where: { id: p.id },
          data: {
            lists: [...new Set([...p.lists, ...(row.lists || [])])],
            tags: [
              ...new Set([
                ...p.tags,
                ...(row.tags || []).map((t) => t.toLowerCase()),
              ]),
            ],
            properties: row.timezone
              ? json({ ...(p.properties as object), timezone: row.timezone })
              : undefined,
            lastOpenedAt:
              opened && (!p.lastOpenedAt || opened > p.lastOpenedAt)
                ? opened
                : undefined,
            lastOrderAt:
              ordered && (!p.lastOrderAt || ordered > p.lastOrderAt)
                ? ordered
                : undefined,
          },
        });
        if (dryRun) throw new Error("DRY_RUN_OK");
      });
      results.push({ row: i + 1, status: "IMPORTED" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import failed";
      results.push(
        message === "DRY_RUN_OK"
          ? { row: i + 1, status: "VALID" }
          : { row: i + 1, status: "ERROR", error: message },
      );
    }
  }
  if (!dryRun)
    await prisma.marketingResource.create({
      data: {
        shop: shop(),
        kind: "IMPORT",
        key: crypto.randomUUID(),
        name: "Klaviyo migration",
        data: json({ at: new Date().toISOString(), results }),
      },
    });
  return results;
}
