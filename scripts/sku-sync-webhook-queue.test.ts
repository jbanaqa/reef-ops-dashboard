import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { createSkuSyncWebhookQueue, drainSkuSyncWebhookEvents, processSkuSyncWebhookEvent } from "../lib/sku-sync/webhook-queue";

let database: PGlite;
let socket: PGLiteSocketServer;
let db: PrismaClient;
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async () => { throw Error("Queue tests must not contact a real service."); };
  database = await PGlite.create();
  await database.exec(`
    CREATE TABLE "SkuSyncWebhookEvent" (
      "id" TEXT PRIMARY KEY, "sourceKey" TEXT NOT NULL, "shop" TEXT NOT NULL,
      "side" TEXT NOT NULL, "variantId" TEXT NOT NULL,
      "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "attempts" INTEGER NOT NULL DEFAULT 0, "claimedAt" TIMESTAMP(3),
      "processedAt" TIMESTAMP(3), "error" TEXT
    );
  `);
  socket = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://postgres:postgres@" + socket.getServerConn() + "/postgres", max: 1 }) });
});

after(async () => {
  await db?.$disconnect();
  await socket?.stop();
  await database?.close();
  globalThis.fetch = originalFetch;
});

function fixture() {
  let time = Date.UTC(2026, 10, 27, 12);
  const namespace = "queue-test-" + randomUUID();
  const state = {
    calls: [] as Array<{ side: "A" | "B"; variantId: string; timeoutMs?: number }>,
    run: async (): Promise<{ status: "busy" | "ignored" | "checked"; synced?: boolean }> => ({ status: "checked", synced: true }),
  };
  const queue = createSkuSyncWebhookQueue({ db, namespace, now: () => new Date(time),
    runForVariant: async (side, variantId, options) => { state.calls.push({ side, variantId, timeoutMs: options?.timeoutMs }); return state.run(); } });
  const seed = async (suffix: string, values: Record<string, unknown> = {}) => {
    const id = `${namespace}:A:${suffix}`;
    await db.skuSyncWebhookEvent.create({ data: {
      id, sourceKey: namespace, shop: "fixture.myshopify.com", side: "A",
      variantId: "gid://shopify/ProductVariant/123", receivedAt: new Date(time), dueAt: new Date(time), ...values,
    } });
    return id;
  };
  return { queue, state, namespace, seed, now: () => new Date(time), advance: (milliseconds: number) => { time += milliseconds; } };
}

test("successful and ignored receipts are terminal and duplicate processing never reruns them", async () => {
  const h = fixture();
  const id = await h.seed("success");
  assert.deepEqual(await h.queue.processEvent(id), { status: "processed", id, outcome: "checked", synced: true });
  assert.deepEqual(await h.queue.processEvent(id), { status: "already-processed", id });
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].timeoutMs, 25_000);
  h.state.run = async () => ({ status: "ignored" });
  const ignored = await h.seed("ignored");
  assert.equal((await h.queue.processEvent(ignored)).status, "processed");
  assert.ok((await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id: ignored } })).processedAt);
});

test("an overlapping delivery cannot claim a receipt already being processed", async () => {
  const h = fixture();
  const id = await h.seed("overlap");
  let started!: () => void;
  let release!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.state.run = async () => { started(); await gate; return { status: "checked" }; };
  const first = h.queue.processEvent(id);
  await running;
  assert.equal((await h.queue.processEvent(id)).status, "busy");
  release();
  assert.equal((await first).status, "processed");
  assert.equal(h.state.calls.length, 1);
  assert.equal((await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } })).attempts, 1);
});

test("namespace contention saves a short retry without losing the receipt", async () => {
  const h = fixture();
  const id = await h.seed("busy");
  h.state.run = async () => ({ status: "busy" });
  assert.equal((await h.queue.processEvent(id)).status, "busy");
  const receipt = await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(receipt.processedAt, null);
  assert.equal(receipt.claimedAt, null);
  assert.equal(receipt.dueAt.getTime(), h.now().getTime() + 10_000);
  assert.equal((await h.queue.processEvent(id)).status, "retry");
  assert.equal(h.state.calls.length, 1);
  h.advance(10_001);
  h.state.run = async () => ({ status: "checked" });
  assert.equal((await h.queue.processEvent(id)).status, "processed");
});

test("transient failures remain retryable with increasing backoff and a successful retry clears the error", async () => {
  const h = fixture();
  const id = await h.seed("failure");
  h.state.run = async () => { throw Error("Fixture provider unavailable"); };
  assert.equal((await h.queue.processEvent(id)).status, "retry");
  let receipt = await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(receipt.error, "Fixture provider unavailable");
  assert.equal(receipt.dueAt.getTime() - h.now().getTime(), 15_000);
  h.advance(15_001);
  assert.equal((await h.queue.processEvent(id)).status, "retry");
  receipt = await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(receipt.dueAt.getTime() - h.now().getTime(), 30_000);
  h.advance(30_001);
  h.state.run = async () => ({ status: "checked", synced: false });
  assert.equal((await h.queue.processEvent(id)).status, "processed");
  assert.equal((await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } })).error, null);
});

test("an interrupted receipt is reclaimed after its lease expires", async () => {
  const h = fixture();
  const id = await h.seed("abandoned", { claimedAt: new Date(h.now().getTime() - 120_001), attempts: 7 });
  assert.equal((await h.queue.processEvent(id)).status, "processed");
  assert.equal((await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } })).attempts, 8);
});

test("a stale worker cannot finalize another owner's claim or delete a newer event for the same variant", async () => {
  const h = fixture();
  const id = await h.seed("fenced");
  const newer = await h.seed("newer");
  const replacementClaim = new Date(h.now().getTime() + 1);
  h.state.run = async () => {
    await db.skuSyncWebhookEvent.update({ where: { id }, data: { claimedAt: replacementClaim, attempts: { increment: 1 }, error: "New owner" } });
    return { status: "checked" };
  };
  assert.equal((await h.queue.processEvent(id)).status, "busy");
  const receipt = await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(receipt.processedAt, null);
  assert.equal(receipt.error, "New owner");
  assert.equal(receipt.claimedAt?.getTime(), replacementClaim.getTime());
  assert.equal((await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id: newer } })).processedAt, null);
});

test("late failure cannot release or overwrite another owner's receipt", async () => {
  const h = fixture();
  const id = await h.seed("late-failure");
  h.state.run = async () => {
    await db.skuSyncWebhookEvent.update({ where: { id }, data: { attempts: { increment: 1 }, error: "New owner's failure" } });
    throw Error("Late old owner error");
  };
  assert.equal((await h.queue.processEvent(id)).status, "retry");
  const receipt = await db.skuSyncWebhookEvent.findUniqueOrThrow({ where: { id } });
  assert.equal(receipt.error, "New owner's failure");
  assert.ok(receipt.claimedAt);
  assert.equal(receipt.attempts, 2);
});

test("the backup drain stops starting new events after its deadline", async () => {
  const h = fixture();
  await h.seed("deadline-first");
  await h.seed("deadline-second");
  h.state.run = async () => { h.advance(25_000); return { status: "checked" }; };
  const result = await h.queue.drain();
  assert.equal(result.attempted, 1);
  assert.equal(result.processed, 1);
  assert.equal(await db.skuSyncWebhookEvent.count({ where: { sourceKey: h.namespace, processedAt: null } }), 1);
});

test("the drain forwards remaining budget and does not run a service when no budget remains", async () => {
  const h = fixture();
  await h.seed("budget");
  assert.equal((await h.queue.drain({ budgetMs: 0 })).attempted, 0);
  assert.equal(h.state.calls.length, 0);
  assert.equal((await h.queue.drain({ budgetMs: 8_000 })).processed, 1);
  assert.equal(h.state.calls[0].timeoutMs, 8_000);
});

test("retention deletes only old completed receipts in the current namespace", async () => {
  const h = fixture();
  const old = new Date(h.now().getTime() - 8 * 24 * 60 * 60_000);
  const pruned = await h.seed("old-completed", { processedAt: old });
  const pending = await h.seed("old-pending", { receivedAt: old, dueAt: new Date(h.now().getTime() + 60_000) });
  const recent = await h.seed("recent-completed", { processedAt: h.now() });
  const foreign = await h.seed("foreign-completed", { sourceKey: "other-namespace", processedAt: old });
  assert.equal((await h.queue.drain()).pruned, 1);
  assert.equal(await db.skuSyncWebhookEvent.findUnique({ where: { id: pruned } }), null);
  for (const id of [pending, recent, foreign])
    assert.ok(await db.skuSyncWebhookEvent.findUnique({ where: { id } }));
  assert.equal((await h.queue.processEvent(foreign)).status, "missing");
});

test("future retries and current claims are skipped while independent receipts for the same variant both complete", async () => {
  const h = fixture();
  await h.seed("future", { dueAt: new Date(h.now().getTime() + 60_000) });
  await h.seed("leased", { claimedAt: h.now() });
  await h.seed("one");
  await h.seed("two");
  const result = await h.queue.drain({ limit: 2 });
  assert.equal(result.attempted, 2);
  assert.equal(result.processed, 2);
  assert.equal(h.state.calls.length, 2);
  assert.equal(await db.skuSyncWebhookEvent.count({ where: { sourceKey: h.namespace, processedAt: null } }), 2);
});

test("paused runtime entry points keep queued receipts pending without loading service configuration", async () => {
  const previous = process.env.SKU_SYNC_ENABLED;
  process.env.SKU_SYNC_ENABLED = "false";
  try {
    const result = await processSkuSyncWebhookEvent("fixture-paused");
    assert.equal(result.status, "busy");
    assert.equal((await drainSkuSyncWebhookEvents()).paused, true);
  } finally {
    if (previous === undefined) delete process.env.SKU_SYNC_ENABLED;
    else process.env.SKU_SYNC_ENABLED = previous;
  }
});
