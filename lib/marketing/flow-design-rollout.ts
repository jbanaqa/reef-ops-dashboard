import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { currentMarketingBrand } from "./context";
import { atomic, json, shop, type Tx } from "./store";
import { type Content, type MarketingSettings, render } from "./rules";
import { scopedMarketingSettings } from "./settings";
import { applyCoralsReefDesign } from "./corals-reef";
import { cartRunKey } from "./cart";
import { isCartContentReference, resolveCartContent, resolveCartConfig, saveCartContent, saveCartConfig } from "./cart-storage";
import type { FlowConfig } from "./flow-config";

const FLOW_KEYS = ["welcome", "abandoned-cart", "b2b-welcome", "delivery-upsell"];
const KIND = "FLOW_DESIGN_ROLLOUT", BATCH = 100;
type ObjectValue = Record<string, unknown>;
type Presentation = Pick<Content, "layout" | "reefDesign">;
type FlowRow = { id: string; key: string; name: string; enabled: boolean; updatedAt: Date; data: Prisma.JsonValue };
type Operation = { version: 1; fingerprint: string; phase: "pending" | "complete"; ceiling: string | null; cursor?: string;
  flows: number; emails: number; messages: number; runs: number; batches: number; startedAt: string; completedAt?: string };
export type FlowDesignPreview = { fingerprint: string; flowCount: number; emailCount: number; pendingCount: number;
  legacyCartCount: number; changedFlowCount: number; samples: { key: string; label: string; html: string }[] };

const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
const presentation = (value: unknown): Presentation => {
  const c = object(value);
  return { ...(c.layout !== undefined ? { layout: c.layout as Content["layout"] } : {}),
    ...(c.reefDesign !== undefined ? { reefDesign: c.reefDesign as Content["reefDesign"] } : {}) };
};
function checkBrand() { if (currentMarketingBrand() !== "corals-anonymous") throw Error("Flow email design is available for Corals Anonymous customer flows."); }
function design(value: unknown, key: string, index?: number, branch?: "yes" | "no") {
  const before = object(value), next = applyCoralsReefDesign(before as Content, key, index, branch);
  // The rollout never adopts incidental defaults or copy changes from a designer.
  return { ...before, layout: next.layout, reefDesign: next.reefDesign };
}
function flowDesign(value: unknown, key: string) {
  const data = object(value), entries: { path: string; before: Presentation; key: string; content: Content }[] = [];
  const next = { ...data };
  if (Array.isArray(data.steps)) next.steps = data.steps.map((raw, index) => {
    const step = object(raw);
    if (key === "abandoned-cart" && index === 2 && object(data.cart).finalOfferEnabled === false) return raw;
    if (step.channel !== "EMAIL" || !step.content) return raw;
    const changed = design(step.content, key, index);
    entries.push({ path: `steps.${index}.content`, before: presentation(step.content), key: `${key}:${index}`, content: changed as Content });
    return { ...step, content: changed };
  });
  if (key === "abandoned-cart" && data.orderBranch) {
    const branches = object(data.orderBranch);
    next.orderBranch = { ...branches };
    for (const branch of ["yes", "no"] as const) {
      const original = object(branches[branch]);
      if (!original.content) continue;
      const changed = design(original.content, key, undefined, branch);
      (next.orderBranch as ObjectValue)[branch] = { ...original, content: changed };
      entries.push({ path: `orderBranch.${branch}.content`, before: presentation(original.content), key: `${key}:${branch}`, content: changed as Content });
    }
  }
  return { data: next, entries };
}
const eligible = (tenant: string): Prisma.MarketingMessageWhereInput => ({ shop: tenant, flowKey: { in: FLOW_KEYS }, channel: "EMAIL",
  campaignId: null, status: "PENDING", attempts: 0, attemptedAt: null, providerId: null, sentAt: null });
async function flows(db: Pick<Tx, "marketingResource">) {
  return db.marketingResource.findMany({ where: { shop: shop(), kind: "FLOW", key: { in: FLOW_KEYS } },
    select: { id: true, key: true, name: true, enabled: true, updatedAt: true, data: true }, orderBy: { key: "asc" } });
}
function plan(rows: FlowRow[]) {
  const changed = rows.map(row => ({ row, ...flowDesign(row.data, row.key) }));
  const fingerprint = hash(changed.map(item => ({ id: item.row.id, key: item.row.key, enabled: item.row.enabled,
    name: item.row.name, at: item.row.updatedAt.toISOString(), before: hash(item.row.data), after: hash(item.data) })));
  return { changed, fingerprint };
}
function sampleContent(c: Content, flowKey: string, data: ObjectValue): Content {
  if (c.products?.length || (flowKey !== "abandoned-cart" && c.template !== "welcome-social")) return c;
  const requested = flowKey === "abandoned-cart" ? object(data.cart).productCount : c.socialProductFeed?.limit;
  const count = typeof requested === "number" ? Math.max(0, Math.min(12, requested)) : 6;
  return { ...c, products: Array.from({ length: count }, (_, index) => ({ title: "Preview coral " + (index + 1),
    price: "$49.00", compareAtPrice: "$79.00", url: "https://example.com/preview-product",
    image: "https://reef-ops-dashboard-production.up.railway.app/product-image-placeholder.png" })) };
}

/** Read-only previews contain dummy personal values, never customer sends or settings writes. */
export async function previewCoralsFlowDesign(): Promise<FlowDesignPreview> {
  checkBrand();
  const planned = plan(await flows(prisma));
  const [pendingCount, legacyCartCount, settingsRow, pendingOperation] = await Promise.all([
    prisma.marketingMessage.count({ where: eligible(shop()) }),
    prisma.marketingMessage.count({ where: { ...eligible(shop()), flowKey: "abandoned-cart", flowCondition: { startsWith: "cart-v1:" } } }),
    prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } } }),
    prisma.marketingResource.findFirst({ where: { shop: shop(), kind: KIND, data: { path: ["phase"], equals: "pending" } },
      orderBy: { updatedAt: "desc" }, select: { key: true, data: true } }),
  ]);
  const settings: MarketingSettings = scopedMarketingSettings(settingsRow?.data);
  const samples = planned.changed.flatMap(item => item.entries.map(entry => ({ key: entry.key,
    label: `${item.row.name} · ${entry.path.startsWith("orderBranch") ? entry.path.split(".")[1] : Number(entry.path.split(".")[1]) + 1}`,
    html: render({ ...sampleContent(entry.content, item.row.key, item.data), ...(entry.content.template === "welcome" || entry.key.endsWith(":no") ||
      (item.row.key === "abandoned-cart" && entry.path.startsWith("steps.") && Number(entry.path.split(".")[1]) > 0)
      ? { couponCode: "PREVIEW-CODE", couponExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString() } : {}) },
    "https://example.com/preview-unsubscribe", settings.postalAddress, "Friend", settings.organizationName, settings.branding) })));
  return { fingerprint: (pendingOperation?.data as { version?: number } | undefined)?.version === 1 ? pendingOperation!.key : planned.fingerprint,
    flowCount: planned.changed.length, emailCount: samples.length, pendingCount, legacyCartCount,
    changedFlowCount: planned.changed.filter(item => hash(item.row.data) !== hash(item.data)).length, samples };
}

/** Each call advances one bounded batch. Repeating the same fingerprint resumes safely. */
export async function applyCoralsFlowDesign(fingerprint: string) {
  checkBrand();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("Preview the flow design before applying it.");
  return atomic(async tx => {
    const operationWhere = { shop: shop(), kind: KIND, key: fingerprint };
    let saved = await tx.marketingResource.findUnique({ where: { shop_kind_key: operationWhere } });
    if (!saved) {
      const planned = plan(await flows(tx));
      if (planned.fingerprint !== fingerprint) throw Error("A flow changed after the preview. Preview the current flow design again.");
      if (!planned.changed.length) throw Error("No Corals Anonymous customer flow emails are configured.");
      const ceiling = await tx.marketingMessage.findFirst({ where: eligible(shop()), select: { id: true }, orderBy: { id: "desc" } });
      const flowUndo = [];
      for (const item of planned.changed) {
        if (hash(item.row.data) === hash(item.data)) continue;
        const updated = await tx.marketingResource.updateMany({ where: { id: item.row.id, shop: shop(), kind: "FLOW",
          enabled: item.row.enabled, name: item.row.name, updatedAt: item.row.updatedAt, data: { equals: json(item.row.data) } }, data: { data: json(item.data) } });
        if (!updated.count) throw Error("A flow changed while applying its design. Preview again.");
        flowUndo.push({ id: item.row.id, key: item.row.key, beforeHash: hash(item.row.data), afterHash: hash(item.data),
          presentation: item.entries.map(entry => ({ path: entry.path, before: entry.before })) });
      }
      const operation: Operation = { version: 1, fingerprint, phase: "pending", ceiling: ceiling?.id || null,
        flows: planned.changed.length, emails: planned.changed.reduce((sum, item) => sum + item.entries.length, 0),
        messages: 0, runs: 0, batches: 0, startedAt: new Date().toISOString() };
      saved = await tx.marketingResource.create({ data: { ...operationWhere, name: "Corals flow email design rollout", data: json(operation) } });
      await tx.marketingResource.create({ data: { shop: shop(), kind: "FLOW_DESIGN_AUDIT", key: fingerprint + ":flows",
        name: "Flow presentation rollback evidence", data: json({ operationId: fingerprint, flows: flowUndo }) } });
    }
    const state = saved.data as unknown as Operation;
    if (state.phase === "complete") return { operationId: fingerprint, done: true, ...state };
    const rows = state.ceiling ? await tx.marketingMessage.findMany({ where: { ...eligible(shop()),
      id: { ...(state.cursor ? { gt: state.cursor } : {}), lte: state.ceiling } }, select: { id: true, key: true, flowKey: true,
        flowCondition: true, flowStep: true, content: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH }) : [];
    const ready = new Set((await tx.marketingResource.findMany({ where: { shop: shop(), kind: { in: ["WELCOME_READY", "CART_READY"] },
      key: { in: rows.map(row => row.id) } }, select: { key: true } })).map(row => row.key));
    const messageUndo = [], runUndo = [], seenRuns = new Set<string>(), configRefs = new Map<string, { before: string; after: string }>();
    for (const row of rows) {
      if (ready.has(row.id)) continue;
      const cart = row.flowKey === "abandoned-cart", branch = row.flowCondition === "cart-v1:final-yes" ? "yes" as const
        : row.flowCondition?.startsWith("cart-v1:final") ? "no" as const : undefined;
      const oldContent = cart ? await resolveCartContent(tx, shop(), row.content) : object(row.content);
      const nextContent = design(oldContent, row.flowKey!, row.flowStep ?? (row.flowCondition === "cart-v1:first" ? 0 : undefined), branch);
      const stored = cart ? await saveCartContent(tx, shop(), nextContent) : json(nextContent);
      if (hash(stored) !== hash(row.content)) {
        const changed = await tx.marketingMessage.updateMany({ where: { ...eligible(shop()), id: row.id, updatedAt: row.updatedAt,
          content: { equals: json(row.content) } }, data: { content: stored } });
        if (changed.count) messageUndo.push({ id: row.id, before: isCartContentReference(row.content)
          ? { cartContentRef: row.content.cartContentRef } : presentation(oldContent), afterHash: hash(stored) });
      }
      if (!cart || !row.flowCondition?.startsWith("cart-v1:") || seenRuns.has(cartRunKey(row.key))) continue;
      const key = cartRunKey(row.key); seenRuns.add(key);
      const run = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "CART_RUN", key } } });
      const data = object(run?.data);
      if (!run || data.sequenceVersion === 2) continue;
      if (typeof data.configRef !== "string" && !data.config) continue;
      const cacheKey = typeof data.configRef === "string" ? data.configRef : hash(data.config);
      let mapped = configRefs.get(cacheKey);
      if (!mapped) {
        const config = typeof data.configRef === "string" ? await resolveCartConfig(tx, shop(), data.configRef) : data.config as FlowConfig | undefined;
        if (!config) continue;
        mapped = { before: typeof data.configRef === "string" ? data.configRef : await saveCartConfig(tx, shop(), config),
          after: await saveCartConfig(tx, shop(), flowDesign(config, "abandoned-cart").data as FlowConfig) };
        configRefs.set(cacheKey, mapped);
      }
      const oldRef = mapped.before, nextRef = mapped.after;
      if (nextRef === oldRef) continue;
      const nextData: ObjectValue = { ...data, configRef: nextRef }; delete nextData.config;
      const changed = await tx.marketingResource.updateMany({ where: { id: run.id, shop: shop(), kind: "CART_RUN", updatedAt: run.updatedAt,
        data: { equals: json(run.data) } }, data: { data: json(nextData) } });
      if (changed.count) runUndo.push({ id: run.id, key, beforeConfigRef: oldRef, afterConfigRef: nextRef, afterHash: hash(nextData) });
    }
    const done = rows.length < BATCH;
    const next: Operation = { ...state, cursor: rows.at(-1)?.id || state.cursor, phase: done ? "complete" : "pending",
      messages: state.messages + messageUndo.length, runs: state.runs + runUndo.length, batches: state.batches + 1,
      ...(done ? { completedAt: new Date().toISOString() } : {}) };
    await tx.marketingResource.create({ data: { shop: shop(), kind: "FLOW_DESIGN_AUDIT", key: fingerprint + ":" + next.batches,
      name: "Pending flow presentation rollback evidence", data: json({ operationId: fingerprint, messages: messageUndo, runs: runUndo }) } });
    const updated = await tx.marketingResource.updateMany({ where: { id: saved.id, data: { equals: json(saved.data) } }, data: { data: json(next) } });
    if (!updated.count) throw Error("Flow design rollout changed. Continue the existing operation.");
    return { operationId: fingerprint, done, ...next };
  });
}

export async function coralsFlowDesignEvidence(operationId: string, after?: string) {
  checkBrand();
  if (!/^[a-f0-9]{64}$/.test(operationId)) throw Error("Choose a valid flow design rollout.");
  const rows = await prisma.marketingResource.findMany({ where: { shop: shop(), ...(after ? { key: { gt: after } } : {}),
    OR: [{ kind: KIND, key: operationId }, { kind: "FLOW_DESIGN_AUDIT", key: { startsWith: operationId + ":" } }] },
    select: { kind: true, key: true, data: true }, orderBy: { key: "asc" }, take: 200 });
  return { rows, next: rows.length === 200 ? rows[rows.length - 1].key : null };
}
