import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { createSkuSyncWebhookReceiver } from "../lib/sku-sync/webhook";

let database: PGlite;
let socket: PGLiteSocketServer;
let db: PrismaClient;
const A = "corals-test.myshopify.com";
const B = "canonical-macro-test.myshopify.com";
const secrets = { A: "test-only-a", B: "test-only-b" };
const itemA = "gid://shopify/InventoryItem/9007199254740993";
const itemB = "gid://shopify/InventoryItem/22";
const variantAId = "gid://shopify/ProductVariant/11";
const variantBId = "gid://shopify/ProductVariant/12";

before(async () => {
  database = await PGlite.create();
  for (const step of ["20261120120000_sku_sync", "20261127210000_sku_sync_webhooks"]) {
    await database.exec(await readFile(`prisma/migrations/${step}/migration.sql`, "utf8"));
  }
  socket = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  db = new PrismaClient({ adapter: new PrismaPg({
    connectionString: "postgresql://postgres:postgres@" + socket.getServerConn() + "/postgres", max: 1,
  }) });
});

after(async () => {
  await db?.$disconnect();
  await socket?.stop();
  await database?.close();
});

async function fixture(enabled = true) {
  const sourceKey = randomUUID();
  await db.skuSyncWebhookShop.createMany({ data: [
    { id: sourceKey + "-A", sourceKey, shop: A, side: "A" },
    { id: sourceKey + "-B", sourceKey, shop: B, side: "B" },
  ] });
  const pair = { id: sourceKey, sourceKey, cloudflareId: "1", name: "Pair", variantAId, variantBId,
    inventoryItemAId: itemA, inventoryItemBId: itemB, initializedAt: new Date() };
  await db.skuSyncPair.create({ data: pair });
  const accept = createSkuSyncWebhookReceiver({ db, namespace: () => sourceKey, secrets, enabled });
  return { accept, pair, receipts: () => db.skuSyncWebhookEvent.findMany({ where: { sourceKey }, orderBy: { side: "asc" } }) };
}

function request(opts: { shop?: string; secret?: string; body?: string; delivery?: string; topic?: string } = {}) {
  const body = opts.body ?? JSON.stringify({ admin_graphql_api_id: itemA, sku: "not trusted" });
  return new Request("https://reef.example/api/webhooks/shopify/sku-sync", { method: "POST", body, headers: {
    "x-shopify-hmac-sha256": createHmac("sha256", opts.secret ?? secrets.A).update(body).digest("base64"),
    "x-shopify-shop-domain": opts.shop ?? A,
    "x-shopify-topic": opts.topic ?? "inventory_items/update",
    "x-shopify-webhook-id": opts.delivery ?? randomUUID(),
  } });
}

test("signed deliveries enqueue only the variant from the verified store; duplicates do not redispatch", async () => {
  const { accept, receipts } = await fixture();
  const delivery = randomUUID();
  const a = await accept(request({ delivery }));
  assert.equal(a.status, 204);
  assert.ok(a.eventId);
  assert.deepEqual(await accept(request({ delivery })), { status: 204 });
  const b = await accept(request({ delivery, shop: B, secret: secrets.B,
    body: JSON.stringify({ admin_graphql_api_id: itemB }) }));
  assert.ok(b.eventId);
  assert.notEqual(a.eventId, b.eventId);
  assert.deepEqual((await receipts()).map(({ shop, side, variantId }) => ({ shop, side, variantId })), [
    { shop: A, side: "A", variantId: variantAId }, { shop: B, side: "B", variantId: variantBId },
  ]);
});

test("rejects wrong secrets, wrong verified side, unknown shop, other topics, and invalid items", async () => {
  const { accept, receipts } = await fixture();
  assert.equal((await accept(request({ secret: "wrong" }))).status, 401);
  assert.equal((await accept(request({ shop: B }))).status, 403);
  assert.equal((await accept(request({ shop: "macro-alias.myshopify.com", secret: secrets.B }))).status, 403);
  assert.equal((await accept(request({ topic: "products/update" }))).status, 400);
  assert.equal((await accept(request({ body: "{" }))).status, 400);
  assert.equal((await accept(request({ body: JSON.stringify({ id: 1 }) }))).status, 400);
  assert.equal((await accept(request({ body: "x".repeat(70_000) }))).status, 413);
  assert.deepEqual(await receipts(), []);
});

test("paused, unmapped, new, inactive, and ambiguous items leave no receipt", async () => {
  const paused = await fixture(false);
  assert.deepEqual(await paused.accept(request()), { status: 204 });
  assert.deepEqual(await paused.receipts(), []);
  const { accept, pair, receipts } = await fixture();
  assert.deepEqual(await accept(request({ body: JSON.stringify({ admin_graphql_api_id: itemB }) })), { status: 204 });
  await db.skuSyncPair.update({ where: { id: pair.id }, data: { initializedAt: null } });
  assert.deepEqual(await accept(request()), { status: 204 });
  await db.skuSyncPair.update({ where: { id: pair.id }, data: { initializedAt: new Date(), active: false } });
  assert.deepEqual(await accept(request()), { status: 204 });
  await db.skuSyncPair.update({ where: { id: pair.id }, data: { active: true } });
  await db.skuSyncPair.create({ data: { ...pair, id: randomUUID(), variantBId: "gid://shopify/ProductVariant/42" } });
  assert.deepEqual(await accept(request()), { status: 204 });
  assert.deepEqual(await receipts(), []);
});

test("does not acknowledge a signed delivery when durable storage fails", async () => {
  const source = await fixture();
  const accept = createSkuSyncWebhookReceiver({
    db, namespace: () => { throw new Error("database/configuration unavailable"); }, secrets, enabled: true,
  });
  assert.equal((await accept(request())).status, 503);
  assert.deepEqual(await source.receipts(), []);
});
