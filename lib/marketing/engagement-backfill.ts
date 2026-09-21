import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { atomic, json, shop } from "./store";

type Phase = "metric" | "events" | "complete";
type State = {
  phase: Phase;
  since: string;
  metricId?: string;
  next?: string;
  events: number;
  profiles: number;
  startedAt: string;
  completedAt?: string;
  leaseUntil?: string;
  leaseOwner?: string;
  error?: string;
};
type Item = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: { profile?: { data?: { id?: string } | null } };
};
type Page = { data: Item[]; included?: Item[]; links?: { next?: string | null } };

const where = () => ({
  shop: shop(),
  kind: "AUDIENCE_SYNC",
  key: "klaviyo-opens",
});

async function page(path: string): Promise<Page> {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key)
    throw new Error(
      "Add KLAVIYO_PRIVATE_API_KEY with events:read, metrics:read, and profiles:read access.",
    );
  const url = new URL(path, "https://a.klaviyo.com");
  if (
    url.origin !== "https://a.klaviyo.com" ||
    !/^\/api\/(metrics|events)\/?$/.test(url.pathname)
  )
    throw new Error("Invalid Klaviyo engagement pagination link.");
  const response = await fetch(url, {
    headers: {
      Authorization: "Klaviyo-API-Key " + key,
      revision: "2026-07-15",
      accept: "application/vnd.api+json",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as
      | { errors?: { detail?: string; title?: string }[] }
      | null;
    const detail = failure?.errors?.[0]?.detail || failure?.errors?.[0]?.title;
    throw new Error(
      response.status === 429
        ? "Klaviyo is busy. Pause briefly, then continue the open-history backfill."
        : response.status === 403
          ? "The Klaviyo key needs events:read, metrics:read, and profiles:read access."
          : `Klaviyo engagement request failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const result = (await response.json()) as Page;
  if (!Array.isArray(result.data))
    throw new Error("Invalid Klaviyo engagement response.");
  return result;
}

export async function engagementBackfillStatus() {
  const resource = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: where() },
  });
  const state = resource?.data as State | undefined;
  return {
    configured: !!process.env.KLAVIYO_PRIVATE_API_KEY,
    phase: state?.phase || "not-started",
    since: state?.since,
    events: state?.events || 0,
    profiles: state?.profiles || 0,
    startedAt: state?.startedAt,
    completedAt: state?.completedAt,
    error: state?.error,
  };
}

async function importEvents(result: Page, state: State) {
  const profiles = new Map(
    (result.included || [])
      .filter((item) => item.type === "profile")
      .map((item) => [
        item.id,
        String(item.attributes.email || "").trim().toLowerCase(),
      ]),
  );
  const latest = new Map<string, Date>();
  for (const event of result.data) {
    const email = profiles.get(event.relationships?.profile?.data?.id || "");
    const at = new Date(String(event.attributes.datetime || ""));
    if (!email || !Number.isFinite(at.getTime()) || at < new Date(state.since))
      continue;
    const previous = latest.get(email);
    if (!previous || at > previous) latest.set(email, at);
  }
  if (!latest.size) return;
  const values = Prisma.join(
    [...latest].map(
      ([email, openedAt]) =>
        Prisma.sql`(${email}::text, ${openedAt}::timestamptz)`,
    ),
  );
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "MarketingProfile" AS profile
    SET "lastOpenedAt" = GREATEST(
      COALESCE(profile."lastOpenedAt", source.opened_at),
      source.opened_at
    )
    FROM (VALUES ${values}) AS source(email, opened_at)
    WHERE profile."shop" = ${shop()} AND profile."email" = source.email
  `);
  state.profiles += Number(updated);
}

/** Imports one Klaviyo page per call so a large history is resumable. */
export async function syncEngagementBackfill() {
  const state = await atomic(async (tx) => {
    const resource = await tx.marketingResource.findUnique({
      where: { shop_kind_key: where() },
    });
    const old = resource?.data as State | undefined;
    if (old?.leaseUntil && new Date(old.leaseUntil) > new Date())
      throw new Error("The open-history backfill is already running.");
    const startedAt = new Date().toISOString();
    const next: State =
      old && old.phase !== "complete"
        ? old
        : {
            phase: "metric",
            since: new Date(Date.now() - 365 * 86400000).toISOString(),
            events: 0,
            profiles: 0,
            startedAt,
          };
    next.leaseUntil = new Date(Date.now() + 300000).toISOString();
    next.leaseOwner = randomUUID();
    delete next.error;
    await tx.marketingResource.upsert({
      where: { shop_kind_key: where() },
      create: { ...where(), name: "Klaviyo open-history backfill", data: json(next) },
      update: { data: json(next) },
    });
    return next;
  });
  try {
    if (state.phase === "metric") {
      const query = new URLSearchParams({
        filter: 'equals(name,"Opened Email")',
        "page[size]": "100",
      });
      const result = await page(`/api/metrics?${query}`);
      const metric = result.data.find(
        (item) =>
          item.type === "metric" && item.attributes.name === "Opened Email",
      );
      if (!metric) throw new Error("Klaviyo's Opened Email metric was not found.");
      state.metricId = metric.id;
      state.phase = "events";
    } else if (state.phase === "events") {
      const query = new URLSearchParams({
        filter: `and(equals(metric_id,"${state.metricId}"),greater-or-equal(datetime,${state.since}))`,
        include: "profile",
        "fields[event]": "datetime",
        "fields[profile]": "email",
        "page[size]": "200",
        sort: "datetime",
      });
      const result = await page(state.next || `/api/events?${query}`);
      await importEvents(result, state);
      state.events += result.data.length;
      state.next = result.links?.next || undefined;
      if (!state.next) {
        state.phase = "complete";
        state.completedAt = new Date().toISOString();
      }
    }
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : "Klaviyo open-history backfill failed.";
  }
  await atomic(async (tx) => {
    const current = await tx.marketingResource.findUniqueOrThrow({
      where: { shop_kind_key: where() },
    });
    if ((current.data as State).leaseOwner !== state.leaseOwner) return;
    delete state.leaseUntil;
    delete state.leaseOwner;
    await tx.marketingResource.update({
      where: { id: current.id },
      data: { data: json(state) },
    });
  });
  return engagementBackfillStatus();
}
