import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type SkuSyncPair } from "@/app/generated/prisma/client";
import { normalizeProductVariantId, type CloudflareMapping } from "./mapping-source";
import { SkuSyncMutationRejectedError, type StoreSide, type VariantSnapshot } from "./shopify";
import { ShopifyRequestNotExecutedError } from "../shopify-request-error";

type SnapshotStore = Omit<VariantSnapshot, "sku"> & { sku: string | null };
export type SkuSyncView = {
  configured: boolean;
  error: string | null;
  checkedAt: string | null;
  lastAutomaticCheckAt: string | null;
  busy: boolean;
  mappings: Array<{
    id: string; name: string; category: string | null; active: boolean;
    storeA: SnapshotStore; storeB: SnapshotStore;
    status: "matching" | "different" | "missing" | "conflict" | "error" | "sync-error" | "waiting" | "inactive";
    canResolve: boolean; error: string | null; checkedAt: string | null;
  }>;
};
export type SkuSyncChoice = {
  mappingId: string; source: StoreSide; expectedSkuA: string; expectedSkuB: string;
  expectedVariantAId: string; expectedVariantBId: string;
};
type Pending = {
  source: StoreSide; desired: string; expectedA: string; expectedB: string;
  variantAId: string; variantBId: string;
  state: "prepared" | "uncertain";
  writeFailed?: true;
};
type Provider = {
  fetchVariantSnapshots(side: StoreSide, ids: string[], options?: { deadline?: number }): Promise<Map<string, VariantSnapshot>>;
  updateVariantSku(side: StoreSide, variant: VariantSnapshot, sku: string, options?: { deadline?: number }): Promise<void>;
};
type Dependencies = {
  db: PrismaClient; namespace: string; fetchMappings(): Promise<CloudflareMapping[]>;
  shopify: Provider; now?: () => Date;
};
export type SkuSyncVariantResult = { status: "busy" | "ignored" | "checked"; synced?: boolean };
export class SkuSyncConflictError extends Error { readonly status = 409; }
export class SkuSyncBusyError extends SkuSyncConflictError {}
const LEASE_MS = 120_000;
const RUN_MS = 90_000;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const message = (error: unknown) => error instanceof Error ? error.message : "SKU synchronization failed.";

/** The database owns baselines and in-flight intent; a page load never writes to Shopify. */
export function createSkuSyncService({ db, namespace, fetchMappings, shopify, now = () => new Date() }: Dependencies) {
  let token: string | null = null;
  let deadline = 0;

  async function acquire() {
    await db.skuSyncControl.upsert({ where: { id: namespace }, create: { id: namespace }, update: {} });
    const owner = randomUUID();
    const result = await db.skuSyncControl.updateMany({
      where: { id: namespace, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now() } }] },
      data: { leaseToken: owner, leaseUntil: new Date(now().getTime() + LEASE_MS) },
    });
    if (!result.count) throw new SkuSyncBusyError("SKU Sync is already checking. Please refresh in a moment.");
    token = owner;
    deadline = Date.now() + RUN_MS;
  }
  async function assertLease() {
    const renewed = await db.skuSyncControl.updateMany({
      where: { id: namespace, leaseToken: token, leaseUntil: { gt: now() } },
      data: { leaseUntil: new Date(now().getTime() + LEASE_MS) },
    });
    if (!token || !renewed.count) throw new SkuSyncBusyError("SKU Sync ownership changed. Refresh before trying again.");
  }
  async function release() {
    if (!token) return;
    await db.skuSyncControl.updateMany({ where: { id: namespace, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
    token = null;
  }
  async function locked<T>(work: () => Promise<T>) {
    await acquire();
    try { return await work(); }
    catch (error) {
      if (!(error instanceof SkuSyncConflictError)) {
        await db.skuSyncControl.updateMany({ where: { id: namespace, leaseToken: token }, data: { error: message(error) } });
      }
      throw error;
    } finally { await release(); }
  }
  async function updatePair(id: string, data: Prisma.SkuSyncPairUpdateInput) {
    await assertLease();
    return db.skuSyncPair.update({ where: { id }, data });
  }
  function pendingOf(row: SkuSyncPair): Pending | null {
    const p = row.pending as unknown as Pending | null;
    if (!p || !["A", "B"].includes(p.source) || typeof p.desired !== "string" ||
      typeof p.expectedA !== "string" || typeof p.expectedB !== "string" ||
      !["prepared", "uncertain"].includes(p.state) || p.variantAId !== row.variantAId || p.variantBId !== row.variantBId) return null;
    return p;
  }
  function storeOf(row: SkuSyncPair, side: StoreSide): SnapshotStore {
    const product = (side === "A" ? row.productA : row.productB) as unknown as VariantSnapshot | null;
    return {
      variantId: side === "A" ? row.variantAId : row.variantBId,
      productId: product?.productId || "", title: product?.title || row.name,
      variantTitle: product?.variantTitle || "", url: product?.url || null,
      sku: side === "A" ? row.currentSkuA : row.currentSkuB,
    };
  }
  async function view(error?: string, busy = false): Promise<SkuSyncView> {
    const [rows, control] = await Promise.all([
      db.skuSyncPair.findMany({ where: { sourceKey: namespace, present: true }, orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }] }),
      db.skuSyncControl.findUnique({ where: { id: namespace } }),
    ]);
    return {
      configured: true, error: error || control?.error || null,
      checkedAt: control?.lastMappingsAt?.toISOString() || null,
      lastAutomaticCheckAt: control?.lastRunAt?.toISOString() || null, busy,
      mappings: rows.map(row => {
        const readable = row.currentSkuA !== null && row.currentSkuB !== null;
        const matching = readable && row.currentSkuA === row.currentSkuB;
        const ambiguous = row.error?.startsWith("This variant appears");
        const pending = readable && !matching && !ambiguous ? pendingOf(row) : null;
        const pendingError = pending?.state === "uncertain"
          ? "The update hasn't been confirmed. Review both SKUs, or choose the same SKU again to retry."
          : pending?.writeFailed === true
            ? `Could not update the SKU in ${pending.source === "A" ? "Macroalgae Farms" : "Corals Anonymous"}. Review both SKUs and try again.`
            : null;
        const rowError = pendingError || row.error;
        const status = !row.active ? "inactive" : pendingError ? "sync-error" : rowError ? "error" : row.conflict ? "conflict" : !row.initializedAt ? "waiting" :
          !readable ? "error" : matching ? "matching" : !row.currentSkuA || !row.currentSkuB ? "missing" : "different";
        return { id: row.id, name: row.name, category: row.category, active: row.active,
          storeA: storeOf(row, "A"), storeB: storeOf(row, "B"), status,
          canResolve: row.active && readable && !matching && !error && !busy && !ambiguous,
          error: rowError || (row.conflict ? "Both SKUs changed. Choose which one to keep." : null), checkedAt: row.checkedAt?.toISOString() || null };
      }),
    };
  }
  async function readMappings() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("SKU Sync mapping check exceeded its deadline.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timed-out GET has no side effects. Never race an entire reconciliation,
    // which could otherwise keep writing after its caller releases the lease.
    const mappings = await Promise.race([
      fetchMappings(),
      new Promise<CloudflareMapping[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SKU Sync mapping check exceeded its deadline.")), remaining);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!Array.isArray(mappings)) throw new Error("The mapping source did not return a complete mapping list.");
    const seen = new Set<string>();
    for (const m of mappings) {
      if (!m.id || seen.has(m.id) || !m.variantAId || !m.variantBId || typeof m.active !== "boolean") throw new Error("The mapping source contains invalid or duplicate mapping IDs.");
      seen.add(m.id);
    }
    await assertLease();
    return mappings;
  }
  async function importMappings() {
    // Nothing is retired if download/validation fails. A valid empty feed retires all pairs.
    const mappings = await readMappings();
    const previous = await db.skuSyncPair.findMany({ where: { sourceKey: namespace } });
    const byId = new Map(previous.map(row => [row.id, row]));
    const countsA = new Map<string, number>(), countsB = new Map<string, number>();
    for (const m of mappings.filter(m => m.active)) {
      countsA.set(m.variantAId, (countsA.get(m.variantAId) || 0) + 1);
      countsB.set(m.variantBId, (countsB.get(m.variantBId) || 0) + 1);
    }
    for (const m of mappings) {
      await assertLease();
      const id = `${namespace}:${m.id}`, old = byId.get(id);
      const ambiguous = m.active && ((countsA.get(m.variantAId) || 0) > 1 || (countsB.get(m.variantBId) || 0) > 1);
      const reset = !old || !old.present || old.variantAId !== m.variantAId || old.variantBId !== m.variantBId || (!old.active && m.active) ||
        (!!old.error?.startsWith("This variant appears") && !ambiguous);
      const data = {
        name: m.name, category: m.category, variantAId: m.variantAId, variantBId: m.variantBId, present: true, active: m.active,
        ...(reset || !m.active ? { initializedAt: null, baselineSkuA: null, baselineSkuB: null, currentSkuA: null, currentSkuB: null,
          inventoryItemAId: null, inventoryItemBId: null,
          productA: Prisma.DbNull, productB: Prisma.DbNull, pending: Prisma.DbNull, conflict: false } : {}),
        error: ambiguous ? "This variant appears in more than one active mapping. Correct the Cloudflare mappings first." : null,
      };
      await db.skuSyncPair.upsert({ where: { id }, create: { id, sourceKey: namespace, cloudflareId: m.id, ...data }, update: data });
    }
    const ids = mappings.map(m => `${namespace}:${m.id}`);
    await assertLease();
    await db.skuSyncPair.updateMany({ where: { sourceKey: namespace, id: { notIn: ids } },
      data: { present: false, active: false, initializedAt: null, inventoryItemAId: null, inventoryItemBId: null,
        pending: Prisma.DbNull, conflict: false } });
    await assertLease();
    await db.skuSyncControl.update({ where: { id: namespace }, data: { error: null } });
    return mappings;
  }
  async function observe() {
    await importMappings();
    const rows = await db.skuSyncPair.findMany({ where: { sourceKey: namespace, present: true, active: true } });
    if (!rows.length) {
      await assertLease();
      await db.skuSyncControl.update({ where: { id: namespace }, data: { lastMappingsAt: now() } });
      return 0;
    }
    await assertLease();
    const [a, b] = await Promise.all([
      shopify.fetchVariantSnapshots("A", rows.map(row => row.variantAId), { deadline }),
      shopify.fetchVariantSnapshots("B", rows.map(row => row.variantBId), { deadline }),
    ]);
    await assertLease();
    let initialized = 0;
    for (const row of rows) {
      const first = a.get(row.variantAId), second = b.get(row.variantBId);
      const ambiguous = row.error?.startsWith("This variant appears");
      const error = ambiguous ? row.error : !first || !second ? "A mapped variant could not be read. No SKU was changed." : null;
      const seed = !row.initializedAt && first && second && !error;
      await updatePair(row.id, {
        currentSkuA: first?.sku ?? null, currentSkuB: second?.sku ?? null,
        ...(first ? { productA: json(first), inventoryItemAId: first.inventoryItemId ?? null } : {}),
        ...(second ? { productB: json(second), inventoryItemBId: second.inventoryItemId ?? null } : {}),
        checkedAt: now(), error,
        ...(seed ? { initializedAt: now(), baselineSkuA: first.sku, baselineSkuB: second.sku, conflict: false, pending: Prisma.DbNull } : {}),
      });
      if (seed) initialized++;
    }
    await assertLease();
    await db.skuSyncControl.update({ where: { id: namespace }, data: { lastMappingsAt: now() } });
    return initialized;
  }
  async function readPair(row: SkuSyncPair) {
    await assertLease();
    const [a, b] = await Promise.all([
      shopify.fetchVariantSnapshots("A", [row.variantAId], { deadline }),
      shopify.fetchVariantSnapshots("B", [row.variantBId], { deadline }),
    ]);
    await assertLease();
    const first = a.get(row.variantAId), second = b.get(row.variantBId);
    if (!first || !second) throw new SkuSyncConflictError("A mapped variant is unavailable. Refresh before trying again.");
    return { a: first, b: second };
  }
  async function settle(row: SkuSyncPair, a: VariantSnapshot, b: VariantSnapshot, source?: StoreSide) {
    await updatePair(row.id, { baselineSkuA: a.sku, baselineSkuB: b.sku, currentSkuA: a.sku, currentSkuB: b.sku,
      inventoryItemAId: a.inventoryItemId ?? null, inventoryItemBId: b.inventoryItemId ?? null,
      productA: json(a), productB: json(b), pending: Prisma.DbNull, conflict: false, error: null, checkedAt: now(),
      ...(source ? { syncedAt: now(), lastChange: json({ source, fromA: row.baselineSkuA, fromB: row.baselineSkuB, sku: a.sku, at: now().toISOString() }) } : {}) });
  }
  async function markConflict(row: SkuSyncPair, a: VariantSnapshot, b: VariantSnapshot) {
    await updatePair(row.id, { currentSkuA: a.sku, currentSkuB: b.sku, productA: json(a), productB: json(b),
      inventoryItemAId: a.inventoryItemId ?? null, inventoryItemBId: b.inventoryItemId ?? null,
      pending: Prisma.DbNull, conflict: true, error: null, checkedAt: now() });
  }
  async function applyPending(row: SkuSyncPair, operation: Pending,
    options: { explicitRetry?: boolean; throwOnFailure?: boolean } = {}): Promise<boolean> {
    const { a, b } = await readPair(row);
    if (a.sku === operation.desired && b.sku === operation.desired) { await settle(row, a, b, operation.source); return true; }
    const source = operation.source === "A" ? a : b, target = operation.source === "A" ? b : a;
    const expectedTarget = operation.source === "A" ? operation.expectedB : operation.expectedA;
    if (source.sku !== operation.desired || target.sku !== expectedTarget) {
      await markConflict(row, a, b); return false;
    }
    if (operation.state === "uncertain" && !options.explicitRetry) {
      await updatePair(row.id, { error: "The previous SKU update could not be confirmed. Refresh to check its result, or choose the same SKU again to retry." });
      return false;
    }
    const uncertain: Pending = { ...operation, state: "uncertain" };
    // Persist intent BEFORE the external write. A timeout/crash must never become a reverse sync.
    await updatePair(row.id, { pending: json(uncertain), error: null });
    await assertLease();
    try {
      await shopify.updateVariantSku(operation.source === "A" ? "B" : "A", target, operation.desired, { deadline });
    } catch (error) {
      // The saved attempt survives Refresh, which replaces only errors from reading the pair.
      await updatePair(row.id, { pending: json({ ...operation, writeFailed: true,
        state: error instanceof ShopifyRequestNotExecutedError || error instanceof SkuSyncMutationRejectedError ? "prepared" : "uncertain" }), error: message(error) });
      if (options.throwOnFailure) throw error;
      return false;
    }
    const actual = await readPair(row);
    if (actual.a.sku === operation.desired && actual.b.sku === operation.desired) {
      await settle(row, actual.a, actual.b, operation.source); return true;
    }
    if ((operation.source === "A" ? actual.a.sku : actual.b.sku) !== operation.desired ||
      ![expectedTarget, operation.desired].includes((operation.source === "A" ? actual.b.sku : actual.a.sku))) {
      await markConflict(row, actual.a, actual.b);
    } else {
      await updatePair(row.id, { currentSkuA: actual.a.sku, currentSkuB: actual.b.sku,
        error: "Shopify accepted the request, but the new SKU is not yet confirmed. It will be checked again automatically." });
    }
    return false;
  }
  /** Both automatic paths use the same baseline/pending/conflict decisions. */
  async function reconcilePair(row: SkuSyncPair, throwOnFailure = false) {
    const pending = pendingOf(row);
    if (pending) return { synced: await applyPending(row, pending, { throwOnFailure }), conflicts: 0 };
    if (row.currentSkuA === row.currentSkuB) {
      if (row.baselineSkuA !== row.currentSkuA || row.baselineSkuB !== row.currentSkuB || row.conflict) {
        const actual = await readPair(row);
        if (actual.a.sku === actual.b.sku) await settle(row, actual.a, actual.b);
      }
    } else if (row.conflict) return { synced: false, conflicts: 1 };
    else {
      const changedA = row.currentSkuA !== row.baselineSkuA, changedB = row.currentSkuB !== row.baselineSkuB;
      if (changedA && changedB) { await updatePair(row.id, { conflict: true }); return { synced: false, conflicts: 1 }; }
      if ((changedA || changedB) && row.currentSkuA !== null && row.currentSkuB !== null) {
        const source: StoreSide = changedA ? "A" : "B";
        const operation: Pending = { source, desired: changedA ? row.currentSkuA : row.currentSkuB,
          expectedA: row.currentSkuA, expectedB: row.currentSkuB, variantAId: row.variantAId, variantBId: row.variantBId, state: "prepared" };
        await updatePair(row.id, { pending: json(operation) });
        return { synced: await applyPending(row, operation, { throwOnFailure }), conflicts: 0 };
      }
    }
    return { synced: false, conflicts: 0 };
  }
  async function refresh(): Promise<SkuSyncView> {
    try { return await locked(async () => { await observe(); return view(); }); }
    catch (error) {
      if (error instanceof SkuSyncBusyError) return view(undefined, true);
      return view(message(error));
    }
  }
  async function run() {
    try {
      return await locked(async () => {
        const initialized = await observe();
        const rows = await db.skuSyncPair.findMany({ where: { sourceKey: namespace, present: true, active: true, initializedAt: { not: null } },
          orderBy: [{ processedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }] });
        let checked = 0, synced = 0, conflicts = 0;
        for (const row of rows) {
          if (Date.now() > deadline - 25_000) break;
          checked++;
          if (row.error?.startsWith("This variant appears") || row.currentSkuA === null || row.currentSkuB === null) continue;
          try {
            const result = await reconcilePair(row);
            if (result.synced) synced++;
            conflicts += result.conflicts;
          } catch (error) {
            if (error instanceof SkuSyncBusyError) throw error;
            await updatePair(row.id, { error: message(error) });
          }
          await updatePair(row.id, { processedAt: now() });
        }
        await assertLease();
        await db.skuSyncControl.update({ where: { id: namespace }, data: { lastRunAt: now(), error: null } });
        return { checked, synced, initialized, conflicts };
      });
    } catch (error) {
      if (error instanceof SkuSyncBusyError) return { checked: 0, synced: 0, initialized: 0, conflicts: 0, busy: true };
      throw error;
    }
  }
  /** A notification is only a wake-up hint, never proof of a SKU or permission to seed a pair. */
  async function runForVariant(side: StoreSide, variantId: string,
    options: { timeoutMs?: number } = {}): Promise<SkuSyncVariantResult> {
    if (side !== "A" && side !== "B") throw new Error("Invalid SKU Sync store.");
    const id = normalizeProductVariantId(variantId);
    const timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("SKU Sync target check needs a positive timeout.");
    const targetDeadline = Date.now() + Math.min(timeoutMs, RUN_MS);
    try {
      return await locked(async (): Promise<SkuSyncVariantResult> => {
        deadline = Math.min(deadline, targetDeadline);
        const active = (await readMappings()).filter(mapping => mapping.active);
        const matches = active.filter(mapping => (side === "A" ? mapping.variantAId : mapping.variantBId) === id);
        if (matches.length !== 1) return { status: "ignored" };
        const mapping = matches[0];
        if (active.some(other => other.id !== mapping.id &&
          (other.variantAId === mapping.variantAId || other.variantBId === mapping.variantBId))) return { status: "ignored" };
        const row = await db.skuSyncPair.findUnique({ where: { id: `${namespace}:${mapping.id}` } });
        if (!row || row.sourceKey !== namespace || !row.present || !row.active || !row.initializedAt ||
          row.variantAId !== mapping.variantAId || row.variantBId !== mapping.variantBId ||
          row.error?.startsWith("This variant appears")) return { status: "ignored" };
        try {
          const { a, b } = await readPair(row);
          const observed = await updatePair(row.id, { currentSkuA: a.sku, currentSkuB: b.sku,
            productA: json(a), productB: json(b), inventoryItemAId: a.inventoryItemId ?? null,
            inventoryItemBId: b.inventoryItemId ?? null, checkedAt: now(), error: null });
          const result = await reconcilePair(observed, true);
          await updatePair(row.id, { processedAt: now() });
          return { status: "checked", synced: result.synced };
        } catch (error) {
          if (error instanceof SkuSyncBusyError) throw error;
          await updatePair(row.id, { error: message(error) });
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof SkuSyncBusyError) return { status: "busy" };
      throw error;
    }
  }
  async function resolve(choice: SkuSyncChoice): Promise<SkuSyncView> {
    return locked(async () => {
      await observe();
      const row = await db.skuSyncPair.findFirst({ where: { id: choice.mappingId, sourceKey: namespace, present: true, active: true } });
      if (!row || row.variantAId !== choice.expectedVariantAId || row.variantBId !== choice.expectedVariantBId) {
        throw new SkuSyncConflictError("This mapping changed. Refresh and choose again.");
      }
      if (row.error?.startsWith("This variant appears")) throw new SkuSyncConflictError(row.error);
      const { a, b } = await readPair(row);
      if (a.sku !== choice.expectedSkuA || b.sku !== choice.expectedSkuB) throw new SkuSyncConflictError("A SKU changed since you opened the confirmation. Refresh and choose again.");
      if (a.sku === b.sku) { await settle(row, a, b); return view(); }
      const desired = choice.source === "A" ? a.sku : b.sku;
      const previousPending = pendingOf(row);
      if (previousPending?.state === "uncertain" && previousPending.desired !== desired) {
        throw new SkuSyncConflictError("An earlier update is still unconfirmed. Choose the same SKU to retry it, or check Shopify before making a different change.");
      }
      const operation: Pending = { source: choice.source, desired, expectedA: a.sku, expectedB: b.sku,
        variantAId: row.variantAId, variantBId: row.variantBId, state: "prepared" };
      await updatePair(row.id, { pending: json(operation), conflict: false, error: null });
      if (!await applyPending(row, operation, { explicitRetry: true })) {
        const latest = await db.skuSyncPair.findUniqueOrThrow({ where: { id: row.id } });
        throw new SkuSyncConflictError(latest.error || "A SKU changed during the update. Refresh to review both stores.");
      }
      return view();
    });
  }
  return { refresh, run, runForVariant, resolve };
}
