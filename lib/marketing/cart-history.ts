import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { atomic, json, record, shop } from "./store";
import { DAY, email } from "./rules";

export function productIdsFromEvent(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const p = value as Record<string, unknown>;
  const id = (v: unknown) =>
    String(v ?? "").replace(/^gid:\/\/shopify\/Product\//, "");
  const direct = [
    p.ProductID,
    p.product_id,
    p.productId,
    p.AddedItemProductID,
    (p.product as { id?: unknown })?.id,
  ]
    .map(id)
    .filter((v) => /^\d+$/.test(v));
  const extra = p.extra as Record<string, unknown> | undefined;
  const items = [p.Items, p.items, p.line_items, extra?.line_items]
    .filter(Array.isArray)
    .flat()
    .slice(0, 500);
  return [
    ...new Set([
      ...direct,
      ...items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const l = item as Record<string, unknown>;
        return [
          l.ProductID,
          l.product_id,
          l.productId,
          (l.product as { id?: unknown })?.id,
        ]
          .map(id)
          .filter((v) => /^\d+$/.test(v));
      }),
    ]),
  ];
}
const wanted: Record<string, { type: string; days: number }> = {
  "Checkout Started": { type: "HISTORY_CHECKOUT", days: 90 },
  "Added to Cart": { type: "HISTORY_CART", days: 90 },
  "Viewed Product": { type: "HISTORY_VIEW", days: 3 },
  "Ordered Product": { type: "HISTORY_SALE", days: 3 },
  "Received Email": { type: "EXTERNAL_EMAIL_SENT", days: 2 },
};
type Metric = { id: string; name: string };
type Sync = {
  coverage?: { until: string; metrics: string[] };
  phase: "metrics" | "events" | "complete";
  until: string;
  since?: string;
  metrics: Metric[];
  index: number;
  next?: string;
  imported: number;
  ignored: number;
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
  relationships?: { profile?: { data?: { id: string } } };
};
type Page = {
  data: KItem[];
  included?: KItem[];
  links?: { next?: string | null };
};
const where = () => ({ shop: shop(), kind: "HISTORY_SYNC", key: "klaviyo" });
export async function historyStatus() {
  const r = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: where() },
  });
  const d = r?.data as Sync | undefined;
  return {
    configured: !!process.env.KLAVIYO_PRIVATE_API_KEY,
    phase: d?.phase || "not-started",
    imported: d?.imported || 0,
    ignored: d?.ignored || 0,
    startedAt: d?.startedAt,
    completedAt: d?.completedAt,
    error: d?.error,
    missingMetrics:
      d?.phase === "complete"
        ? Object.keys(wanted).filter(
            (name) => !d.metrics.some((m) => m.name === name),
          )
        : [],
    metric: d?.metrics?.[d.index]?.name,
  };
}
async function getPage(path: string): Promise<Page> {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key)
    throw new Error(
      "Add KLAVIYO_PRIVATE_API_KEY in Railway with events:read, metrics:read and profiles:read access. Do not paste the key into chat.",
    );
  const url = new URL(path, "https://a.klaviyo.com");
  if (
    url.origin !== "https://a.klaviyo.com" ||
    !/^\/api\/(events|metrics)\/?$/.test(url.pathname)
  )
    throw new Error("Invalid Klaviyo pagination link.");
  const r = await fetch(url, {
    headers: {
      Authorization: "Klaviyo-API-Key " + key,
      revision: "2026-07-15",
      accept: "application/vnd.api+json",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!r.ok)
    throw new Error(
      r.status === 429
        ? "Klaviyo is busy. Wait a minute, then continue."
        : "Klaviyo history request failed (" +
          r.status +
          "). Check API access.",
    );
  const page = (await r.json()) as Page;
  if (!Array.isArray(page.data))
    throw new Error("Invalid Klaviyo history response.");
  return page;
}
/** Staff-triggered read-only import, one page per call with durable progress. Never enrolls or changes consent. */
export async function syncHistory() {
  if (!process.env.KLAVIYO_PRIVATE_API_KEY) await getPage("/api/metrics/");
  const state = await atomic(async (tx) => {
    const r = await tx.marketingResource.findUnique({
      where: { shop_kind_key: where() },
    });
    const old = r?.data as Sync | undefined;
    if (old?.leaseUntil && new Date(old.leaseUntil) > new Date())
      throw new Error("History import is already running. Try again shortly.");
    const until = new Date().toISOString();
    const d: Sync =
      old && old.phase !== "complete"
        ? old
        : {
            phase: "metrics",
            until,
            since: old?.until,
            metrics: [],
            index: 0,
            imported: 0,
            ignored: 0,
            startedAt: until,
            coverage: old?.coverage,
          };
    d.leaseUntil = new Date(Date.now() + 300000).toISOString();
    d.leaseOwner = randomUUID();
    delete d.error;
    await tx.marketingResource.upsert({
      where: { shop_kind_key: where() },
      create: { ...where(), name: "Klaviyo history", data: json(d) },
      update: { data: json(d) },
    });
    return d;
  });
  try {
    if (state.phase === "metrics") {
      const page = await getPage(state.next || "/api/metrics/");
      for (const item of page.data) {
        const name = String(item.attributes.name || "");
        if (wanted[name] && !state.metrics.some((m) => m.id === item.id))
          state.metrics.push({ id: item.id, name });
      }
      state.next = page.links?.next || undefined;
      if (!state.next)
        state.phase = state.metrics.length ? "events" : "complete";
    } else if (state.phase === "events") {
      const metric = state.metrics[state.index],
        spec = wanted[metric.name];
      const since = new Date(
        Math.max(
          +new Date(state.until) - spec.days * DAY,
          state.since && state.coverage?.metrics.includes(metric.name)
            ? +new Date(state.since) - 180000
            : 0,
        ),
      ).toISOString();
      const params = new URLSearchParams({
        filter: `equals(metric_id,"${metric.id}"),greater-or-equal(datetime,${since}),less-than(datetime,${state.until})`,
        include: "profile",
        "fields[profile]": "email",
        "page[size]": "200",
        sort: "datetime",
      });
      const page = await getPage(state.next || "/api/events/?" + params);
      const profiles = new Map(
        (page.included || [])
          .filter((p) => p.type === "profile")
          .map((p) => [p.id, p]),
      );
      for (const event of page.data) {
        const at = new Date(String(event.attributes.datetime));
        if (
          !Number.isFinite(+at) ||
          at < new Date(since) ||
          at >= new Date(state.until)
        ) {
          state.ignored++;
          continue;
        }
        let address: string | undefined;
        try {
          address = email(
            profiles.get(event.relationships?.profile?.data?.id || "")
              ?.attributes.email,
          );
        } catch {}
        const properties =
          (event.attributes.event_properties as Record<string, unknown>) || {};
        const ids = productIdsFromEvent(properties);
        if (spec.type === "EXTERNAL_EMAIL_SENT" ? !address : !ids.length) {
          state.ignored++;
          continue;
        }
        const profile = address
          ? await prisma.marketingProfile.findUnique({
              where: { shop_email: { shop: shop(), email: address } },
              select: { id: true },
            })
          : null;
        await atomic((tx) =>
          record(tx, {
            key: "klaviyo:" + event.id,
            type: spec.type,
            profileId: profile?.id,
            occurredAt: at,
            payload: {
              source: "klaviyo",
              email: address || "",
              productIds: ids,
              quantity: Math.max(1, Number(properties.Quantity) || 1),
              sourceProfileId: event.relationships?.profile?.data?.id || "",
              metric: metric.name,
            },
          }),
        );
        state.imported++;
      }
      state.next = page.links?.next || undefined;
      if (!state.next && ++state.index >= state.metrics.length)
        state.phase = "complete";
    }
    if (state.phase === "complete") {
      state.completedAt = new Date().toISOString();
      state.coverage = {
        until: state.until,
        metrics: state.metrics.map((m) => m.name),
      };
    }
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : "History import failed";
  }
  await atomic(async (tx) => {
    const current = await tx.marketingResource.findUniqueOrThrow({
      where: { shop_kind_key: where() },
    });
    if ((current.data as Sync).leaseOwner !== state.leaseOwner) return;
    delete state.leaseUntil;
    delete state.leaseOwner;
    await tx.marketingResource.update({
      where: { id: current.id },
      data: { data: json(state) },
    });
  });
  return historyStatus();
}
