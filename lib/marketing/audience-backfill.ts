import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { importProfiles, ImportRow } from "./ingest";
import { email, phone } from "./rules";
import { atomic, json, shop } from "./store";
import type { Tx } from "./store";

type Phase = "lists" | "profiles" | "memberships" | "complete";
type KlaviyoList = { id: string; name: string };
type AudienceIssue = { profile: string; phase: string; error: string };
type Sync = {
  phase: Phase;
  lists: KlaviyoList[];
  listIndex: number;
  next?: string;
  profiles: number;
  memberships: number;
  suppressed: number;
  ignored: number;
  errors: number;
  issues?: AudienceIssue[];
  startedAt: string;
  completedAt?: string;
  leaseUntil?: string;
  leaseOwner?: string;
  error?: string;
};
type KItem = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
};
type Page = { data: KItem[]; links?: { next?: string | null } };

const where = () => ({
  shop: shop(),
  kind: "AUDIENCE_SYNC",
  key: "klaviyo",
});

const savedAudienceKey = (list: KlaviyoList) =>
  `klaviyo-list-${list.id}`.slice(0, 100);

async function saveImportedListAudiences(
  tx: Tx,
  lists: KlaviyoList[],
) {
  for (const list of lists)
    await tx.marketingResource.upsert({
      where: {
        shop_kind_key: {
          shop: shop(),
          kind: "SEGMENT",
          key: savedAudienceKey(list),
        },
      },
      create: {
        shop: shop(),
        kind: "SEGMENT",
        key: savedAudienceKey(list),
        name: list.name,
        data: json({ list: list.name }),
      },
      update: {
        name: list.name,
        data: json({ list: list.name }),
      },
    });
}

export type AudienceBackfillStatus = Awaited<
  ReturnType<typeof audienceBackfillStatus>
>;

export async function audienceBackfillStatus() {
  const [resource, reviewCount, reviewRows] = await Promise.all([
    prisma.marketingResource.findUnique({
      where: { shop_kind_key: where() },
    }),
    prisma.marketingResource.count({
      where: { shop: shop(), kind: "AUDIENCE_REVIEW" },
    }),
    prisma.marketingResource.findMany({
      where: { shop: shop(), kind: "AUDIENCE_REVIEW" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { data: true },
    }),
  ]);
  const state = resource?.data as Sync | undefined;
  return {
    configured: !!process.env.KLAVIYO_PRIVATE_API_KEY,
    phase: state?.phase || "not-started",
    profiles: state?.profiles || 0,
    memberships: state?.memberships || 0,
    suppressed: state?.suppressed || 0,
    ignored: state?.ignored || 0,
    errors: state?.errors || 0,
    reviewCount,
    lists: state?.lists?.map((list) => list.name) || [],
    currentList:
      state?.phase === "memberships"
        ? state.lists[state.listIndex]?.name
        : undefined,
    startedAt: state?.startedAt,
    completedAt: state?.completedAt,
    error: state?.error,
    issues: reviewRows.map((row) => row.data as AudienceIssue),
  };
}

async function getPage(path: string): Promise<Page> {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key)
    throw new Error(
      "Add KLAVIYO_PRIVATE_API_KEY in Railway with profiles:read and lists:read access.",
    );
  const url = new URL(path, "https://a.klaviyo.com");
  if (
    url.origin !== "https://a.klaviyo.com" ||
    !/^\/api\/(profiles|lists\/?|lists\/[^/]+\/profiles)\/?$/.test(
      url.pathname,
    )
  )
    throw new Error("Invalid Klaviyo audience pagination link.");
  const response = await fetch(url, {
    headers: {
      Authorization: "Klaviyo-API-Key " + key,
      revision: "2026-07-15",
      accept: "application/vnd.api+json",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Klaviyo is busy. Pause briefly, then continue the audience backfill."
        : response.status === 403
          ? "The Klaviyo key needs profiles:read and lists:read access."
          : `Klaviyo audience request failed (${response.status}). Check API access.`,
    );
  const page = (await response.json()) as Page;
  if (!Array.isArray(page.data))
    throw new Error("Invalid Klaviyo audience response.");
  return page;
}

type MarketingSubscription = {
  consent?: unknown;
  consent_timestamp?: unknown;
  last_updated?: unknown;
  method?: unknown;
  suppression?: unknown;
  list_suppressions?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validDate(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function status(value: unknown) {
  const normalized = String(value || "").toUpperCase();
  return ["SUBSCRIBED", "UNSUBSCRIBED", "NEVER_SUBSCRIBED"].includes(
    normalized,
  )
    ? normalized
    : undefined;
}

function suppressionRows(value: unknown) {
  return Array.isArray(value)
    ? value.map(object).filter((row) => Object.keys(row).length)
    : [];
}

function latestTimestamp(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => validDate(row.timestamp))
    .filter((value): value is string => !!value)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
}

function tagsFromProperties(value: unknown) {
  const properties = object(value);
  const entry = Object.entries(properties).find(
    ([key]) => key.toLowerCase().replace(/[^a-z]/g, "") === "shopifytags",
  );
  if (!entry) return [];
  const raw = Array.isArray(entry[1])
    ? entry[1]
    : String(entry[1] || "").split(",");
  return [
    ...new Set(
      raw
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 250),
    ),
  ];
}

function identity(attributes: Record<string, unknown>) {
  let address: string | undefined;
  let number: string | undefined;
  try {
    if (attributes.email) address = email(attributes.email);
  } catch {}
  try {
    if (attributes.phone_number) number = phone(attributes.phone_number);
  } catch {}
  return { address, number };
}

/** Converts only evidence explicitly returned by Klaviyo; it never infers consent. */
export function klaviyoProfileRow(
  item: KItem,
  membership?: KlaviyoList,
): { row?: ImportRow; suppressed: boolean } {
  const attributes = object(item.attributes);
  const { address, number } = identity(attributes);
  if (!address && !number) return { suppressed: false };
  const subscriptions = object(attributes.subscriptions);
  const emailMarketing = object(object(subscriptions.email).marketing) as MarketingSubscription;
  const smsMarketing = object(object(subscriptions.sms).marketing) as MarketingSubscription;
  const emailSuppressions = suppressionRows(emailMarketing.suppression);
  const listSuppressions = suppressionRows(emailMarketing.list_suppressions);
  const membershipSuppressed = !!membership && listSuppressions.some(
    (entry) => String(entry.list_id || "") === membership.id,
  );
  const emailStatus = status(emailMarketing.consent);
  const smsStatus = status(smsMarketing.consent);
  const emailSuppressed = emailSuppressions.length > 0;
  const emailAt =
    latestTimestamp(emailSuppressions) ||
    validDate(emailMarketing.consent_timestamp) ||
    validDate(emailMarketing.last_updated);
  const smsAt =
    validDate(smsMarketing.consent_timestamp) ||
    validDate(smsMarketing.last_updated);
  const location = object(attributes.location);
  const first = String(attributes.first_name || "").trim();
  const last = String(attributes.last_name || "").trim();
  const row: ImportRow = {
    email: address,
    phone: number,
    name: [first, last].filter(Boolean).join(" ") || undefined,
    tags: tagsFromProperties(attributes.properties),
    timezone:
      typeof location.timezone === "string" ? location.timezone : undefined,
    ...(emailStatus || emailSuppressed
      ? {
          emailStatus: emailSuppressed ? "UNSUBSCRIBED" : emailStatus,
          emailSuppressed,
          emailConsentAt: emailAt,
          emailConsentSource: `klaviyo:${String(emailMarketing.method || "api").toLowerCase()}`,
        }
      : {}),
    ...(smsStatus
      ? {
          smsStatus,
          smsConsentAt: smsAt,
          smsConsentSource: `klaviyo:${String(smsMarketing.method || "api").toLowerCase()}`,
        }
      : {}),
    ...(membership
      ? membershipSuppressed
        ? { removeLists: [membership.name] }
        : { lists: [membership.name] }
      : {}),
  };
  // A subscribed status without its evidence must not grant permission.
  if (row.emailStatus === "SUBSCRIBED" && !row.emailConsentAt)
    delete row.emailStatus;
  if (row.smsStatus === "SUBSCRIBED" && !row.smsConsentAt)
    delete row.smsStatus;
  return {
    row,
    suppressed: membership ? membershipSuppressed : emailSuppressed,
  };
}

async function importPage(
  page: Page,
  state: Sync,
  membership?: KlaviyoList,
) {
  const converted = page.data.map((item) => klaviyoProfileRow(item, membership));
  state.ignored += converted.filter((entry) => !entry.row).length;
  state.suppressed += converted.filter((entry) => entry.suppressed).length;
  const entries = converted.flatMap((entry, index) =>
    entry.row ? [{ item: page.data[index], row: entry.row }] : [],
  );
  const rows = entries.map((entry) => entry.row);
  if (!rows.length) return;
  // Email is the Klaviyo marketing identity. Keep Shopify's current phone and
  // never move a phone that already belongs to another profile.
  const [emailProfiles, phoneProfiles] = await Promise.all([
    prisma.marketingProfile.findMany({
      where: {
        shop: shop(),
        email: { in: rows.flatMap((row) => (row.email ? [row.email] : [])) },
      },
      select: { email: true },
    }),
    prisma.marketingProfile.findMany({
      where: {
        shop: shop(),
        phone: { in: rows.flatMap((row) => (row.phone ? [row.phone] : [])) },
      },
      select: { email: true, phone: true },
    }),
  ]);
  const existingEmails = new Set(
    emailProfiles.flatMap((profile) => (profile.email ? [profile.email] : [])),
  );
  const phoneOwners = new Map(
    phoneProfiles.flatMap((profile) =>
      profile.phone ? [[profile.phone, profile.email] as const] : [],
    ),
  );
  const batchPhoneEmails = new Map<string, Set<string>>();
  for (const row of rows)
    if (row.email && row.phone) {
      const addresses = batchPhoneEmails.get(row.phone) || new Set<string>();
      addresses.add(row.email);
      batchPhoneEmails.set(row.phone, addresses);
    }
  for (const row of rows)
    if (
      row.email &&
      row.phone &&
      (existingEmails.has(row.email) ||
        (phoneOwners.has(row.phone) && phoneOwners.get(row.phone) !== row.email) ||
        (batchPhoneEmails.get(row.phone)?.size || 0) > 1)
    )
      delete row.phone;
  // The consent table already retains the imported state, source, and timestamp.
  // Avoid a second event row per channel during this large snapshot migration.
  const results = await importProfiles(
    rows,
    false,
    "Klaviyo API audience backfill",
    false,
  );
  const failures = results.filter((result) => result.status === "ERROR");
  state.errors += failures.length;
  state.issues ||= [];
  for (const failure of failures) {
    const row = rows[failure.row - 1];
    if (state.issues.length < 25)
      state.issues.push({
        profile: row?.email || row?.phone || `row ${failure.row}`,
        phase: membership ? membership.name : "Profiles",
        error: failure.error || "Import failed",
      });
  }
  await atomic(async (tx) => {
    for (const result of results) {
      const entry = entries[result.row - 1];
      if (!entry) continue;
      const key = entry.item.id.slice(0, 100);
      if (result.status === "ERROR")
        await tx.marketingResource.upsert({
          where: {
            shop_kind_key: { shop: shop(), kind: "AUDIENCE_REVIEW", key },
          },
          create: {
            shop: shop(),
            kind: "AUDIENCE_REVIEW",
            key,
            name: "Klaviyo profile needs review",
            data: json({
              profile: entry.row.email || entry.row.phone || entry.item.id,
              phase: membership ? membership.name : "Profiles",
              error: result.error || "Import failed",
            }),
          },
          update: {
            data: json({
              profile: entry.row.email || entry.row.phone || entry.item.id,
              phase: membership ? membership.name : "Profiles",
              error: result.error || "Import failed",
            }),
          },
        });
      else if (!membership)
        await tx.marketingResource.deleteMany({
          where: { shop: shop(), kind: "AUDIENCE_REVIEW", key },
        });
    }
  });
  if (membership)
    state.memberships += results.filter((result) => {
      const row = rows[result.row - 1];
      return result.status === "IMPORTED" && !!row?.lists?.length;
    }).length;
  else
    state.profiles += results.filter(
      (result) => result.status === "IMPORTED",
    ).length;
}

/** Staff-triggered, one-page-at-a-time import. It never calls flow enrollment. */
export async function syncAudienceBackfill() {
  if (!process.env.KLAVIYO_PRIVATE_API_KEY) await getPage("/api/lists");
  const state = await atomic(async (tx) => {
    const resource = await tx.marketingResource.findUnique({
      where: { shop_kind_key: where() },
    });
    const old = resource?.data as Sync | undefined;
    if (old?.leaseUntil && new Date(old.leaseUntil) > new Date())
      throw new Error("The audience backfill is already running.");
    const now = new Date().toISOString();
    const next: Sync =
      old && old.phase !== "complete"
        ? old
        : {
            phase: "lists",
            lists: [],
            listIndex: 0,
            profiles: 0,
            memberships: 0,
            suppressed: 0,
            ignored: 0,
            errors: 0,
            issues: [],
            startedAt: now,
          };
    next.leaseUntil = new Date(Date.now() + 300000).toISOString();
    next.leaseOwner = randomUUID();
    delete next.error;
    await tx.marketingResource.upsert({
      where: { shop_kind_key: where() },
      create: {
        ...where(),
        name: "Klaviyo audience backfill",
        data: json(next),
      },
      update: { data: json(next) },
    });
    return next;
  });

  try {
    if (state.phase === "lists") {
      const page = await getPage(
        state.next || "/api/lists?page[size]=10&fields[list]=name",
      );
      for (const item of page.data) {
        const name = String(item.attributes.name || "").trim();
        if (item.type === "list" && item.id && name)
          state.lists.push({ id: item.id, name });
      }
      state.next = page.links?.next || undefined;
      if (!state.next) state.phase = "profiles";
    } else if (state.phase === "profiles") {
      const page = await getPage(
        state.next ||
          "/api/profiles?page[size]=100&additional-fields[profile]=subscriptions",
      );
      await importPage(page, state);
      state.next = page.links?.next || undefined;
      if (!state.next) state.phase = state.lists.length ? "memberships" : "complete";
    } else if (state.phase === "memberships") {
      const list = state.lists[state.listIndex];
      if (!list) {
        state.phase = "complete";
      } else {
        const page = await getPage(
          state.next ||
            `/api/lists/${encodeURIComponent(list.id)}/profiles?page[size]=100&additional-fields[profile]=subscriptions`,
        );
        await importPage(page, state, list);
        state.next = page.links?.next || undefined;
        if (!state.next && ++state.listIndex >= state.lists.length)
          state.phase = "complete";
      }
    }
    if (state.phase === "complete") state.completedAt = new Date().toISOString();
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : "Klaviyo audience backfill failed.";
  }

  await atomic(async (tx) => {
    const current = await tx.marketingResource.findUniqueOrThrow({
      where: { shop_kind_key: where() },
    });
    if ((current.data as Sync).leaseOwner !== state.leaseOwner) return;
    delete state.leaseUntil;
    delete state.leaseOwner;
    if (state.phase === "complete" && !state.error)
      await saveImportedListAudiences(tx, state.lists);
    await tx.marketingResource.update({
      where: { id: current.id },
      data: { data: json(state) },
    });
  });
  return audienceBackfillStatus();
}
