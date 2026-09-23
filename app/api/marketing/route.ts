import { historyStatus, syncHistory } from "@/lib/marketing/cart-history";
import {
  audienceBackfillStatus,
  syncAudienceBackfill,
} from "@/lib/marketing/audience-backfill";
import { cartReport } from "@/lib/marketing/cart-report";
import { campaignReport } from "@/lib/marketing/campaign-report";
import { marketingAnalytics } from "@/lib/marketing/analytics";
import {
  engagementBackfillStatus,
  setEngagementBackfillRunning,
} from "@/lib/marketing/engagement-backfill";
import {
  campaignAudience,
  resolveCampaignAudience,
  resolvedAudienceWhere,
} from "@/lib/marketing/campaign-audience";
import { cartProducts } from "@/lib/marketing/cart";
import { cartReadiness } from "@/lib/marketing/cart";
import { readStock, lowStock } from "@/lib/marketing/stock";
import { validateStock } from "@/lib/marketing/stock-config";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { prisma } from "@/lib/prisma";
import {
  audienceWhere,
  atomic,
  consent,
  json,
  record,
  seed,
  shop,
} from "@/lib/marketing/store";
import {
  content,
  date,
  defaultContent,
  defaultMarketingSettings,
  email,
  extractEmailBranding,
  marketingSettings,
  MarketingSettings,
  render,
  segment,
  sharedEmailFooter,
  withBranding,
} from "@/lib/marketing/rules";
import { resendProvider, setup } from "@/lib/marketing/delivery";
import { processMarketingInbox, inboxUnresolved } from "@/lib/marketing/inbox";
import { audienceDirectory, contactDetails } from "@/lib/marketing/audiences";
import { runMarketing } from "@/lib/marketing/worker";
import { importProfiles } from "@/lib/marketing/ingest";
import {
  cancelTestMessage,
  clearUnsentTestMessages,
  sendTestMessageNow,
} from "@/lib/marketing/message-test";
import { validateFlow } from "@/lib/marketing/flow-config";
import { enrollExistingWelcomeTest, removeProfileFromList } from "@/lib/marketing/profile-testing";
import { shopifyGraphql } from "@/lib/shopify";
import { resolveCampaignProductFeeds, resolveWelcomeSocialProducts } from "@/lib/marketing/campaign-product-feed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function loadMarketingSettings() {
  const row = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  const settings = marketingSettings(
    row?.data,
    process.env.MARKETING_POSTAL_ADDRESS ||
      defaultMarketingSettings.postalAddress,
  );
  if (settings.branding.footerConfigured) return settings;
  const delivery = await prisma.marketingResource.findUnique({
    where: {
      shop_kind_key: {
        shop: shop(),
        kind: "FLOW",
        key: "delivery-upsell",
      },
    },
  });
  const source =
    (
      delivery?.data as
        | { steps?: { content?: unknown }[] }
        | undefined
    )?.steps?.[0]?.content || {
      ...defaultContent,
      template: "b2b-wholesale",
      footerTitle: "Thank you for your business ❤️",
      footerBackgroundColor: "#244b7b",
      footerTextColor: "#ffffff",
    };
  const updated = marketingSettings({
    ...settings,
    branding: {
      ...settings.branding,
      ...sharedEmailFooter(
        withBranding(content(source), settings.branding),
      ),
    },
  });
  await prisma.marketingResource.upsert({
    where: {
      shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
    },
    create: {
      shop: shop(),
      kind: "SETTINGS",
      key: "global",
      name: "Marketing settings",
      data: json(updated),
      enabled: true,
    },
    update: { data: json(updated), enabled: true },
  });
  return updated;
}
async function saveDiscoveredBranding(value: unknown, footerSource?: unknown) {
  const extracted = extractEmailBranding(value);
  const discovered = footerSource
    ? { ...extracted, ...sharedEmailFooter(footerSource) }
    : {
        ...(extracted.logo ? { logo: extracted.logo } : {}),
        ...(extracted.logoScale !== undefined
          ? { logoScale: extracted.logoScale }
          : {}),
      };
  if (!Object.keys(discovered).length) return;
  const existing = await loadMarketingSettings();
  const updated = marketingSettings({
    ...existing,
    branding: { ...existing.branding, ...discovered },
  });
  await prisma.marketingResource.upsert({
    where: {
      shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
    },
    create: {
      shop: shop(),
      kind: "SETTINGS",
      key: "global",
      name: "Marketing settings",
      data: json(updated),
      enabled: true,
    },
    update: { data: json(updated), enabled: true },
  });
}

const campaignOptions = (body: Record<string, unknown>) => ({
  smartSendingHours: body.smartSending === false ? 0 : 16,
  recipientMode:
    body.recipientMode === "SCHEDULE_TIME" ? "SCHEDULE_TIME" : "SEND_TIME",
});

async function checkedCampaignAudience(value: unknown) {
  const parsed = campaignAudience(value);
  const resolved = await atomic((tx) => resolveCampaignAudience(tx, parsed));
  if (resolved.missingKeys.length)
    throw new Error(
      `Selected audience no longer exists: ${resolved.missingKeys.join(", ")}`,
    );
  return { parsed, resolved };
}

async function scheduleCampaign(id: string, scheduledAt: Date) {
  const campaign = await prisma.marketingCampaign.findFirst({
    where: { id, shop: shop(), status: "DRAFT" },
  });
  if (!campaign) throw new Error("Only drafts can be scheduled.");
  const { resolved } = await checkedCampaignAudience(campaign.audience);
  if (campaign.recipientMode === "SCHEDULE_TIME") {
    const profiles = await prisma.marketingProfile.findMany({
      where: resolvedAudienceWhere(resolved, campaign.channel),
      select: { id: true },
      orderBy: { id: "asc" },
    });
    await prisma.marketingMessage.deleteMany({
      where: { campaignId: campaign.id },
    });
    for (let offset = 0; offset < profiles.length; offset += 1000)
      await prisma.marketingMessage.createMany({
        data: profiles.slice(offset, offset + 1000).map((profile) => ({
          shop: shop(),
          key: `campaign:${campaign.id}:${profile.id}`,
          campaignId: campaign.id,
          profileId: profile.id,
          channel: campaign.channel,
          subject: campaign.subject,
          content: json(campaign.content),
          dueAt: scheduledAt,
        })),
        skipDuplicates: true,
      });
    const result = await prisma.marketingCampaign.updateMany({
      where: { id: campaign.id, shop: shop(), status: "DRAFT" },
      data: {
        status: "SCHEDULED",
        scheduledAt,
        expandedAt: new Date(),
      },
    });
    if (!result.count) throw new Error("Campaign scheduling changed; reload it.");
    return profiles.length;
  }
  const result = await prisma.marketingCampaign.updateMany({
    where: { id: campaign.id, shop: shop(), status: "DRAFT" },
    data: { status: "SCHEDULED", scheduledAt, expandedAt: null },
  });
  if (!result.count) throw new Error("Only drafts can be scheduled.");
  return null;
}

const SHOPIFY_MARKETING_WEBHOOK_TOPICS = [
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "CUSTOMER_TAGS_ADDED",
  "CUSTOMER_TAGS_REMOVED",
  "CUSTOMERS_EMAIL_MARKETING_CONSENT_UPDATE",
  "CUSTOMERS_MARKETING_CONSENT_UPDATE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "CHECKOUTS_CREATE",
  "CHECKOUTS_UPDATE",
] as const;

type ShopifyWebhookList = {
  data?: {
    webhookSubscriptions?: {
      nodes?: { id: string; topic: string; uri: string }[];
    };
  };
};
type ShopifyWebhookCreate = {
  data?: {
    webhookSubscriptionCreate?: {
      webhookSubscription?: { id: string; topic: string; uri: string } | null;
      userErrors?: { field?: string[]; message: string }[];
    };
  };
};

const SHOPIFY_WEBHOOKS_QUERY = `
  query MarketingWebhookSubscriptions {
    webhookSubscriptions(first: 250) {
      nodes { id topic uri }
    }
  }
`;

const SHOPIFY_WEBHOOK_CREATE = `
  mutation MarketingWebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

async function registerShopifyMarketingWebhooks() {
  const publicBase =
    process.env.APP_BASE_URL || process.env.REEF_OPS_PUBLIC_URL;
  if (!publicBase)
    throw new Error(
      "APP_BASE_URL or REEF_OPS_PUBLIC_URL is required to register Shopify webhooks.",
    );
  const callback = new URL("/api/marketing/webhooks", publicBase);
  callback.searchParams.set("source", "shopify");
  const callbackUrl = callback.toString();
  const existing = await shopifyGraphql<ShopifyWebhookList>(
    SHOPIFY_WEBHOOKS_QUERY,
  );
  const current = existing.data?.webhookSubscriptions?.nodes || [];
  const results: {
    topic: string;
    status: "EXISTING" | "CREATED" | "SKIPPED";
    id?: string;
    message?: string;
  }[] = [];
  for (const topic of SHOPIFY_MARKETING_WEBHOOK_TOPICS) {
    const found = current.find(
      (w) => w.topic === topic && w.uri === callbackUrl,
    );
    if (found) {
      results.push({ topic, status: "EXISTING", id: found.id });
      continue;
    }
    const response = await shopifyGraphql<ShopifyWebhookCreate>(
      SHOPIFY_WEBHOOK_CREATE,
      { topic, webhookSubscription: { uri: callbackUrl } },
    );
    const created = response.data?.webhookSubscriptionCreate;
    const errors = created?.userErrors || [];
    if (errors.length) {
      const message = errors.map((e) => e.message).join("; ");
      // Shopify can report a duplicate when an equivalent subscription exists
      // but is not returned by the current page; it is safe to continue.
      if (/already exists|duplicate|taken/i.test(message)) {
        results.push({ topic, status: "SKIPPED", message });
        continue;
      }
      throw new Error(`Could not register ${topic}: ${message}`);
    }
    results.push({
      topic,
      status: "CREATED",
      id: created?.webhookSubscription?.id,
    });
  }
  return { callbackUrl, results };
}
function authorize(request: Request) {
  if (!isDashboardRequestAuthorized(request))
    return Response.json({ error: "Login required" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin) {
    const allowed = new Set<string>();
    // The request URL may be the private origin used by a reverse proxy.
    allowed.add(new URL(request.url).origin);
    // Trust the public origin configured for links and storefront callbacks.
    if (process.env.APP_BASE_URL) {
      try {
        allowed.add(new URL(process.env.APP_BASE_URL).origin);
      } catch {
        /* invalid config is reported by setup */
      }
    }
    // Next/Vercel and common ingress proxies expose the browser-facing host.
    const forwardedHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const forwardedProto = (
      request.headers.get("x-forwarded-proto") ||
      new URL(request.url).protocol.replace(":", "")
    )
      .split(",")[0]
      .trim();
    if (forwardedHost)
      allowed.add(`${forwardedProto}://${forwardedHost.split(",")[0].trim()}`);
    if (!allowed.has(origin))
      return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
}
export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url),
      view = url.searchParams.get("view") || "overview";
    if (view === "cart-report")
      return Response.json(await cartReport(), {
        headers: { "Cache-Control": "no-store" },
      });
    if (view === "campaign-report")
      return Response.json(
        await campaignReport(url.searchParams.get("id") || ""),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (view === "analytics")
      return Response.json(
        await marketingAnalytics(Number(url.searchParams.get("days") || 30)),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (view === "cart-history")
      return Response.json(await historyStatus(), {
        headers: { "Cache-Control": "no-store" },
      });
    if (view === "audience-backfill")
      return Response.json(await audienceBackfillStatus(), {
        headers: { "Cache-Control": "no-store" },
      });
    if (view === "engagement-backfill")
      return Response.json(await engagementBackfillStatus(), {
        headers: { "Cache-Control": "no-store" },
      });
    if (view === "tracking-pixel") {
      const template = await (
        await import("node:fs/promises")
      ).readFile(
        process.cwd() + "/shopify/reef-marketing-custom-pixel.js",
        "utf8",
      );
      const base = process.env.APP_BASE_URL || process.env.REEF_OPS_PUBLIC_URL;
      if (!base || new URL(base).protocol !== "https:")
        throw new Error("Configure the public Reef Ops URL first.");
      return new Response(
        template.replace("https://YOUR-REEF-OPS-HOST", new URL(base).origin),
        {
          headers: {
            "Content-Type": "text/javascript",
            "Content-Disposition":
              "attachment; filename=reef-marketing-custom-pixel.js",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (view === "stock-status") {
      const status = await prisma.marketingResource.findUnique({
        where: {
          shop_kind_key: { shop: shop(), kind: "SYSTEM", key: "stock-check" },
        },
      });
      return Response.json(
        { status: status?.data || null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (view === "contact")
      return Response.json(
        { profile: await contactDetails(url.searchParams.get("id") || "") },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (view === "audience")
      return Response.json(await audienceDirectory(url), {
        headers: { "Cache-Control": "no-store" },
      });
    if (view === "preview") {
      const s = await loadMarketingSettings();
      return new Response(
        render(
          defaultContent,
          "#unsubscribe",
          s.postalAddress,
          undefined,
          s.organizationName,
          s.branding,
        ),
        {
          headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
        },
      );
    }
    if (view === "profile") {
      const profile = await prisma.marketingProfile.findFirst({
        where: { shop: shop(), id: url.searchParams.get("id") || "" },
        include: {
          consents: true,
          events: { orderBy: { occurredAt: "desc" }, take: 100 },
          messages: { orderBy: { createdAt: "desc" }, take: 100 },
        },
      });
      return Response.json({ profile });
    }
    const [
      profiles,
      campaigns,
      resources,
      counts,
      messageCounts,
      eventCounts,
      orders,
    ] = await Promise.all([
      prisma.marketingProfile.findMany({
        where: {
          shop: shop(),
          ...(url.searchParams.get("q")
            ? {
                OR: [
                  {
                    email: {
                      contains: url.searchParams.get("q")!,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    name: {
                      contains: url.searchParams.get("q")!,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
        ...(url.searchParams.get("cursor")
          ? { cursor: { id: url.searchParams.get("cursor")! }, skip: 1 }
          : {}),
        include: { consents: true },
      }),
      prisma.marketingCampaign.findMany({
        where: { shop: shop() },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { _count: { select: { messages: true } } },
      }),
      prisma.marketingResource.findMany({
        where: {
          shop: shop(),
          kind: { in: ["FLOW", "SEGMENT", "TEMPLATE", "SYSTEM", "SETTINGS"] },
        },
        orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
        take: 200,
      }),
      Promise.all([
        prisma.marketingProfile.count({ where: { shop: shop() } }),
        prisma.marketingProfile.count({
          where: audienceWhere({ openedDays: 365 }),
        }),
        prisma.marketingConsent.count({
          where: { suppressed: true, profile: { shop: shop() } },
        }),
      ]),
      prisma.marketingMessage.groupBy({
        by: ["status", "channel", "campaignId", "flowKey"],
        where: { shop: shop() },
        _count: true,
      }),
      prisma.marketingEvent.groupBy({
        by: ["type"],
        where: { shop: shop() },
        _count: true,
      }),
      prisma.marketingEvent.findMany({
        where: { shop: shop(), type: "ORDER", messageId: { not: null } },
        select: { payload: true, messageId: true },
        take: 10000,
      }),
    ]);
    const revenue: Record<string, number> = {};
    for (const order of orders) {
      const p = order.payload as { currency: string; revenue: string };
      revenue[p.currency] = (revenue[p.currency] || 0) + Number(p.revenue || 0);
    }
    const settings = await loadMarketingSettings();
    const health = {
      inbox: await prisma.marketingWebhookInbox.findMany({
        where: { shop: shop(), status: { not: "DONE" } },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: {
          id: true,
          topic: true,
          status: true,
          attempts: true,
          error: true,
          createdAt: true,
        },
      }),
      unresolved: await prisma.marketingWebhookInbox.count({
        where: { shop: shop(), status: { not: "DONE" } },
      }),
      oldestPending: await prisma.marketingMessage.findFirst({
        where: { shop: shop(), status: "PENDING" },
        orderBy: { dueAt: "asc" },
        select: { dueAt: true, error: true },
      }),
    };
    return Response.json(
      {
        health,
        profiles,
        nextCursor: profiles.length === 100 ? profiles[99].id : null,
        campaigns,
        resources,
        settings,
        counts: {
          profiles: counts[0],
          mailable: counts[1],
          suppressions: counts[2],
        },
        messageCounts,
        eventCounts,
        revenue,
        revenueCapped: orders.length === 10000,
        setup: setup(settings.operations, settings.postalAddress),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Marketing read failed", e);
    return Response.json(
      {
        error:
          "Marketing data is unavailable. Apply the marketing migration and configure DATABASE_URL and SHOPIFY_SHOP_DOMAIN.",
      },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 12000000) throw new Error("Request too large.");
    const b = JSON.parse(raw);
    if (b.action === "check-stock") return Response.json(await lowStock());
    if (b.action === "remove-profile-list") {
      if (typeof b.profileId !== "string" || typeof b.list !== "string")
        throw new Error("Choose a contact and one of their lists.");
      return Response.json(await removeProfileFromList(b.profileId, b.list));
    }
    if (b.action === "enroll-existing-welcome-test") {
      if (typeof b.profileId !== "string")
        throw new Error("Choose a contact first.");
      return Response.json(await enrollExistingWelcomeTest(b.profileId));
    }
    if (b.action === "preview-stock") {
      const s = validateStock(b.stock);
      const snapshot = await readStock(s);
      const tracked = snapshot.variants.filter(
        (v) => v.inventoryItem.tracked && v.inventoryQuantity !== null,
      );
      return Response.json({
        collection: snapshot.collectionName,
        checked: tracked.length,
        low: tracked.filter((v) => v.inventoryQuantity! < s.threshold).length,
        variants: tracked
          .filter((v) => v.inventoryQuantity! < s.threshold)
          .slice(0, 50)
          .map((v) => ({
            id: v.id,
            product: v.product.title,
            variant: v.title,
            quantity: v.inventoryQuantity,
          })),
        at: snapshot.observedAt.toISOString(),
      });
    }
    if (
      b.action === "send-test-message-now" ||
      b.action === "send-cart-test-now"
    ) {
      if (typeof b.profileId !== "string" || typeof b.messageId !== "string")
        throw new Error("Choose a test message.");
      return Response.json(await sendTestMessageNow(b.profileId, b.messageId));
    }
    if (
      b.action === "cancel-test-message" ||
      b.action === "cancel-cart-test-message"
    ) {
      if (typeof b.profileId !== "string" || typeof b.messageId !== "string")
        throw new Error("Choose a test message.");
      await cancelTestMessage(b.profileId, b.messageId);
      return Response.json({ ok: true });
    }
    if (
      b.action === "clear-unsent-test-messages" ||
      b.action === "clear-cart-test-history"
    ) {
      if (typeof b.profileId !== "string")
        throw new Error("Choose a contact first.");
      return Response.json({
        cleared: await clearUnsentTestMessages(b.profileId),
      });
    }
    if (b.action === "run-delivery") {
      return Response.json(await runMarketing());
    }
    if (b.action === "process-inbox") {
      const result = await processMarketingInbox();
      if (result.disabled)
        return Response.json(
          {
            error:
              "Shopify ingestion is disabled. Enable and save ingestion settings first.",
          },
          { status: 409 },
        );
      return Response.json({ ...result, unresolved: await inboxUnresolved() });
    }
    if (b.action === "retry-inbox") {
      const result = await prisma.marketingWebhookInbox.updateMany({
        where: {
          id: String(b.id),
          shop: shop(),
          status: { in: ["FAILED", "PENDING"] },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          dueAt: new Date(),
          error: null,
        },
      });
      if (!result.count)
        throw new Error("Event is already processing or complete.");
      return Response.json({ ok: true });
    }
    if (b.action === "initialize") {
      await seed();
      return Response.json({ ok: true });
    }
    if (b.action === "register-shopify-webhooks")
      return Response.json(await registerShopifyMarketingWebhooks());
    if (b.action === "preview") {
      const s = await loadMarketingSettings();
      const previewContent = await resolveCampaignProductFeeds(
        content(b.content),
        `campaign-preview:${crypto.randomUUID()}`,
      );
      return Response.json({
        html: render(
          previewContent,
          "#unsubscribe",
          s.postalAddress,
          undefined,
          s.organizationName,
        ),
      });
    }
    if (b.action === "preview-campaign-feeds")
      return Response.json({
        content: await resolveCampaignProductFeeds(
          content(b.content),
          `campaign-preview:${crypto.randomUUID()}`,
        ),
      });
    if (b.action === "preview-welcome-social-feed")
      return Response.json({
        content: await resolveWelcomeSocialProducts(content(b.content), `welcome-social-preview:${crypto.randomUUID()}`),
      });
    if (b.action === "test-email") {
      const to = email(b.to);
      const allowed = (process.env.MARKETING_TEST_EMAILS || "")
        .split(",")
        .map((v) => v.trim().toLowerCase());
      if (!allowed.includes(to))
        throw new Error(
          "Test recipient must be listed in MARKETING_TEST_EMAILS.",
        );
      const s = await loadMarketingSettings();
      if (!setup(s.operations, s.postalAddress).emailReady)
        throw new Error("Complete email provider setup first.");
      const id = crypto.randomUUID();
      const testContent = await resolveCampaignProductFeeds(
        content(b.content),
        `campaign-test:${id}`,
      );
      const testBranding = {
        ...s.branding,
        ...sharedEmailFooter(testContent),
      };
      const providerId = await resendProvider.send({
        id,
        to,
        channel: "EMAIL",
        subject: `[TEST] ${String(b.subject || "Campaign preview").slice(0, 190)}`,
        content: testContent,
        address: s.postalAddress,
        organizationName: s.organizationName,
        branding: testBranding,
        internalPreview: true,
        unsubscribe: `${process.env.APP_BASE_URL}/api/marketing/unsubscribe?preview=1`,
      });
      // Test sends do not have a profile/message row, so persist the provider
      // ID under a deterministic key for delivery webhooks to resolve.
      await atomic((tx) =>
        record(tx, {
          key: `test-provider:${providerId}`,
          type: "TEST_SENT",
          payload: { to, providerId },
        }),
      );
      return Response.json({ ok: true });
    }
    if (b.action === "import")
      return Response.json({
        results: await importProfiles(b.rows, b.dryRun !== false),
      });
    if (b.action === "save-settings") {
      const existing = await loadMarketingSettings();
      const incoming = (b.settings || {}) as Partial<MarketingSettings>;
      const s = marketingSettings({
        ...existing,
        ...incoming,
        operations: { ...existing.operations, ...(incoming.operations || {}) },
      });
      const result = await prisma.marketingResource.upsert({
        where: {
          shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
        },
        create: {
          shop: shop(),
          kind: "SETTINGS",
          key: "global",
          name: "Marketing settings",
          data: json(s),
          enabled: true,
        },
        update: { data: json(s), enabled: true },
      });
      await atomic((tx) =>
        record(tx, {
          key: `staff:settings:${crypto.randomUUID()}`,
          type: "CONFIG_CHANGED",
          payload: {
            kind: "SETTINGS",
            key: "global",
            operations: s.operations,
            attribution: s.attribution,
          },
        }),
      );
      return Response.json({ ...result, settings: s });
    }
    if (b.action === "audience-count") {
      const { resolved } = await checkedCampaignAudience(b.audience);
      return Response.json({
        count: await prisma.marketingProfile.count({
          where: resolvedAudienceWhere(resolved),
        }),
      });
    }
    if (b.action === "suppress") {
      const p = await prisma.marketingProfile.findFirst({
        where: { id: b.id, shop: shop() },
      });
      if (!p) throw new Error("Profile not found.");
      if (!["EMAIL", "SMS_MARKETING", "SMS_TRANSACTIONAL"].includes(b.channel))
        throw new Error("Invalid channel.");
      await atomic((tx) =>
        consent(
          tx,
          p.id,
          b.channel,
          "UNSUBSCRIBED",
          "staff",
          new Date(),
          "Staff suppression",
        ),
      );
      return Response.json({ ok: true });
    }
    if (b.action === "save-campaign") {
      if (!String(b.name || "").trim() || !String(b.subject || "").trim())
        throw new Error("Campaign name and subject are required.");
      const { parsed } = await checkedCampaignAudience(b.audience);
      const data = {
        name: String(b.name).slice(0, 200),
        subject: String(b.subject).slice(0, 200),
        content: json(content(b.content)),
        audience: json(parsed),
        ...campaignOptions(b),
      };
      await saveDiscoveredBranding(data.content, b.brandingSource);
      if (b.id) {
        const result = await prisma.marketingCampaign.updateMany({
          where: { id: b.id, shop: shop(), status: "DRAFT" },
          data,
        });
        if (!result.count) throw new Error("Only drafts can be edited.");
        return Response.json({ id: b.id });
      }
      const result = await prisma.marketingCampaign.create({
        data: { shop: shop(), ...data },
      });
      return Response.json({ id: result.id });
    }
    if (b.action === "schedule") {
      const scheduledAt = date(b.at);
      if (scheduledAt < new Date())
        throw new Error("Choose a future send time.");
      const recipients = await scheduleCampaign(String(b.id), scheduledAt);
      const s = await loadMarketingSettings();
      return Response.json({
        ok: true,
        recipients,
        sendingEnabled: setup(s.operations, s.postalAddress).sendingEnabled,
      });
    }
    if (b.action === "send-now") {
      const recipients = await scheduleCampaign(String(b.id), new Date());
      const s = await loadMarketingSettings();
      return Response.json({
        ok: true,
        recipients,
        sendingEnabled: setup(s.operations, s.postalAddress).sendingEnabled,
      });
    }
    if (b.action === "cancel") {
      await atomic(async (tx) => {
        const c = await tx.marketingCampaign.findFirst({
          where: { id: b.id, shop: shop() },
        });
        if (!c) throw new Error("Campaign not found.");
        await tx.marketingCampaign.update({
          where: { id: c.id },
          data: { status: "CANCELLED" },
        });
        await tx.marketingMessage.updateMany({
          where: { campaignId: c.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
      });
      return Response.json({ ok: true });
    }
    if (b.action === "sync-cart-history")
      return Response.json(await syncHistory());
    if (b.action === "sync-klaviyo-audience")
      return Response.json(await syncAudienceBackfill());
    if (b.action === "start-klaviyo-opens")
      return Response.json(await setEngagementBackfillRunning(true));
    if (b.action === "pause-klaviyo-opens")
      return Response.json(await setEngagementBackfillRunning(false));
    if (b.action === "preview-cart-products") {
      const address = email(b.email);
      const p = await prisma.marketingProfile.findUnique({
        where: { shop_email: { shop: shop(), email: address } },
        select: { id: true },
      });
      if (!p)
        throw new Error("Find or import this customer in Audiences first.");
      const f = validateFlow("abandoned-cart", b.flow);
      if (!f.cart) throw new Error("Review the cart flow first.");
      const products = await cartProducts({
        profileId: p.id,
        config: f,
        productIds: [],
        url: "https://coralsanonymous.com/cart",
      });
      return Response.json({ products });
    }
    if (b.action === "cart-readiness")
      return Response.json(await cartReadiness());
    if (b.action === "save-resource") {
      if (!["SEGMENT", "TEMPLATE", "FLOW"].includes(b.kind))
        throw new Error("Unsupported resource.");
      let data;
      if (b.kind === "FLOW") {
        const f = validateFlow(String(b.key || ""), b.data);
        if (b.enabled && !f.reviewed)
          throw new Error("Review the flow configuration before enabling.");
        if (b.enabled && b.key === "low-stock") validateStock(f.stock, true);
        if (b.enabled && b.key === "welcome" && !f.welcome)
          throw new Error("Open and review the updated welcome flow before enabling it.");
        if (b.enabled && b.key === "delivery-upsell" && !f.delivery)
          throw new Error("Open and review the updated delivery upsell before enabling it.");
        if (b.enabled && b.key === "abandoned-cart" && !f.cart)
          throw new Error(
            "Open and review the updated cart flow before enabling it.",
          );
        data = json(f);
      } else
        data = json(b.kind === "SEGMENT" ? segment(b.data) : content(b.data));
      const key = String(b.key || crypto.randomUUID()).slice(0, 100);
      const result = await prisma.marketingResource.upsert({
        where: { shop_kind_key: { shop: shop(), kind: b.kind, key } },
        create: {
          shop: shop(),
          kind: b.kind,
          key,
          name: String(b.name).slice(0, 200),
          data,
          enabled: !!b.enabled,
        },
        update: {
          name: String(b.name).slice(0, 200),
          data,
          enabled: !!b.enabled,
        },
      });
      await saveDiscoveredBranding(data, b.brandingSource);
      await atomic((tx) =>
        record(tx, {
          key: `staff:${crypto.randomUUID()}`,
          type: "CONFIG_CHANGED",
          payload: { kind: b.kind, key, enabled: !!b.enabled },
        }),
      );
      return Response.json(result);
    }
    throw new Error("Unknown action.");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Request failed" },
      { status: 400 },
    );
  }
}
