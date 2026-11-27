import type { PrismaClient } from "@/app/generated/prisma/client";
import type { StoreSide } from "./shopify";

const CLAIM_MILLISECONDS = 120_000;
const RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const DRAIN_MILLISECONDS = 20_000;
const EVENT_MILLISECONDS = 25_000;

type VariantResult = { status: "busy" | "ignored" | "checked"; synced?: boolean };
type Dependencies = {
  db: Pick<PrismaClient, "skuSyncWebhookEvent">;
  namespace: string;
  runForVariant(side: StoreSide, variantId: string, options?: { timeoutMs?: number }): Promise<VariantResult>;
  now?: () => Date;
};

export type SkuSyncWebhookResult =
  | { status: "missing" | "already-processed"; id: string }
  | { status: "processed"; id: string; outcome: "ignored" | "checked"; synced: boolean }
  | { status: "busy" | "retry"; id: string; retryAt: string; error?: string };

export type SkuSyncWebhookDrainResult = {
  attempted: number;
  processed: number;
  retry: number;
  busy: boolean;
  pruned: number;
  paused?: boolean;
};

function retryDelay(attempt: number, busy: boolean) {
  // Contention should clear quickly. Other failures back off indefinitely so a
  // temporary provider/configuration problem never discards a signed receipt.
  return busy ? 10_000 : Math.min(15_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6), 15 * 60_000);
}

/** Only this receipt's owner may complete or release it; no variant-wide deletion. */
export function createSkuSyncWebhookQueue({ db, namespace, runForVariant, now = () => new Date() }: Dependencies) {
  async function processEvent(id: string, options: { deadline?: number } = {}): Promise<SkuSyncWebhookResult> {
    const deadline = options.deadline ?? now().getTime() + EVENT_MILLISECONDS;
    const receipt = await db.skuSyncWebhookEvent.findFirst({ where: { id, sourceKey: namespace } });
    if (!receipt) return { status: "missing", id };
    if (receipt.processedAt) return { status: "already-processed", id };

    const claimedAt = now();
    if (receipt.dueAt > claimedAt)
      return { status: "retry", id, retryAt: receipt.dueAt.toISOString() };
    if (receipt.claimedAt && receipt.claimedAt.getTime() > claimedAt.getTime() - CLAIM_MILLISECONDS)
      return { status: "busy", id, retryAt: new Date(receipt.claimedAt.getTime() + CLAIM_MILLISECONDS).toISOString() };

    const attempt = receipt.attempts + 1;
    const claimed = await db.skuSyncWebhookEvent.updateMany({
      where: {
        id, sourceKey: namespace, processedAt: null, attempts: receipt.attempts,
        dueAt: { lte: claimedAt },
        OR: [{ claimedAt: null }, { claimedAt: { lte: new Date(claimedAt.getTime() - CLAIM_MILLISECONDS) } }],
      },
      data: { claimedAt, attempts: { increment: 1 }, error: null },
    });
    if (!claimed.count)
      return { status: "busy", id, retryAt: new Date(claimedAt.getTime() + CLAIM_MILLISECONDS).toISOString() };

    const ownership = { id, sourceKey: namespace, processedAt: null, claimedAt, attempts: attempt };
    async function retry(error: string, busy = false): Promise<SkuSyncWebhookResult> {
      const dueAt = new Date(now().getTime() + retryDelay(attempt, busy));
      await db.skuSyncWebhookEvent.updateMany({
        where: ownership,
        data: { claimedAt: null, dueAt, error: error.slice(0, 1_000) },
      });
      return { status: busy ? "busy" : "retry", id, retryAt: dueAt.toISOString(), error };
    }

    try {
      if (receipt.side !== "A" && receipt.side !== "B")
        return await retry("The queued SKU event has an invalid store side.");
      const remaining = deadline - now().getTime();
      if (remaining < 1_000) return await retry("The SKU event was deferred to the next background check.", true);
      const result = await runForVariant(receipt.side, receipt.variantId, { timeoutMs: Math.min(EVENT_MILLISECONDS, remaining) });
      if (result.status === "busy") return await retry("SKU Sync is already checking; this event will retry.", true);
      const completed = await db.skuSyncWebhookEvent.updateMany({
        where: ownership,
        data: { processedAt: now(), claimedAt: null, error: null },
      });
      if (!completed.count)
        return { status: "busy", id, retryAt: new Date(now().getTime() + CLAIM_MILLISECONDS).toISOString() };
      return { status: "processed", id, outcome: result.status, synced: result.synced === true };
    } catch (error) {
      return retry(error instanceof Error ? error.message : "SKU webhook processing failed.");
    }
  }

  async function drain({ limit = 10, budgetMs = DRAIN_MILLISECONDS }: { limit?: number; budgetMs?: number } = {}): Promise<SkuSyncWebhookDrainResult> {
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(25, Math.floor(limit))) : 10;
    const startedAt = now();
    const budget = Number.isFinite(budgetMs) ? Math.max(0, Math.min(90_000, budgetMs)) : DRAIN_MILLISECONDS;
    const deadline = startedAt.getTime() + budget;
    if (budget < 1_000) return { attempted: 0, processed: 0, retry: 0, busy: false, pruned: 0 };
    const receipts = await db.skuSyncWebhookEvent.findMany({
      where: {
        sourceKey: namespace, processedAt: null, dueAt: { lte: startedAt },
        OR: [{ claimedAt: null }, { claimedAt: { lte: new Date(startedAt.getTime() - CLAIM_MILLISECONDS) } }],
      },
      orderBy: [{ dueAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
      take: count,
      select: { id: true },
    });
    const results: SkuSyncWebhookResult[] = [];
    for (const receipt of receipts) {
      // The service receives the remaining batch budget and never gets more
      // than 25s for one event. Leave time for its durable error/finalization.
      if (deadline - now().getTime() < 1_000) break;
      const result = await processEvent(receipt.id, { deadline });
      results.push(result);
      if (result.status === "busy") break;
    }
    const removed = deadline - now().getTime() > 250 ? await db.skuSyncWebhookEvent.deleteMany({
      where: { sourceKey: namespace, processedAt: { lt: new Date(now().getTime() - RETENTION_MILLISECONDS) } },
    }) : { count: 0 };
    return {
      attempted: results.length,
      processed: results.filter(result => result.status === "processed").length,
      retry: results.filter(result => result.status === "retry").length,
      busy: results.some(result => result.status === "busy"),
      pruned: removed.count,
    };
  }

  return { processEvent, drain };
}

async function runtimeQueue() {
  const [{ prisma }, { getSkuSyncService, getSkuSyncNamespace }] = await Promise.all([
    import("../prisma"), import("./runtime"),
  ]);
  return createSkuSyncWebhookQueue({ db: prisma, namespace: getSkuSyncNamespace(),
    runForVariant: (side, variantId, options) => getSkuSyncService().runForVariant(side, variantId, options) });
}

export async function processSkuSyncWebhookEvent(id: string): Promise<SkuSyncWebhookResult> {
  if (process.env.SKU_SYNC_ENABLED?.trim().toLowerCase() === "false")
    return { status: "busy", id, retryAt: new Date(Date.now() + 60_000).toISOString(), error: "Automatic SKU synchronization is paused." };
  return (await runtimeQueue()).processEvent(id);
}

export async function drainSkuSyncWebhookEvents(options: { limit?: number; budgetMs?: number } = {}): Promise<SkuSyncWebhookDrainResult> {
  if (process.env.SKU_SYNC_ENABLED?.trim().toLowerCase() === "false")
    return { attempted: 0, processed: 0, retry: 0, busy: false, pruned: 0, paused: true };
  return (await runtimeQueue()).drain(options);
}
