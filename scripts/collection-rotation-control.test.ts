import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { NextRequest } from "next/server";

const shop = "rotation-test.myshopify.com";
const collectionId = "gid://shopify/Collection/1";
const url = new URL("/api/collection-rotation/control", "https://reef.test");
url.searchParams.set("collectionId", collectionId);

const product = (id: number, title: string, status = "ACTIVE") => ({
  id: `gid://shopify/Product/${id}`,
  legacyResourceId: String(id),
  title,
  handle: `product-${id}`,
  status,
  featuredImage: null,
});
const clownfish = product(1, "Ocellaris Clownfish");
const keptTop = product(2, "Still in the collection", "DRAFT");
const keptBottom = product(3, "Kept bottom pin");
const oldTop = product(4, "Previous sale pin");
const oldBottom = product(5, "Previous bottom pin");
const extra = product(6, "Unpinned product");

const originalFetch = globalThis.fetch;
const envVars = ["DATABASE_URL", "SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"];
const originalEnv = new Map(envVars.map((name) => [name, process.env[name]]));
let pages = [[clownfish, extra], [keptTop, keptBottom]];
let db: PGlite;
let socket: PGLiteSocketServer;
let prisma: typeof import("../lib/prisma").prisma;
let routes: typeof import("../app/api/collection-rotation/control/route");

before(async () => {
  db = await PGlite.create();
  for (const migration of [
    "20260714170009_add_collection_rotation",
    "20260714172531_add_collection_rotation_stars",
    "20260714180348_add_controlled_collection_products",
    "20260727160000_add_weighted_collection_rotation",
    "20260730120000_add_controlled_bottom_positions",
  ]) {
    await db.exec(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"));
  }
  socket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
  process.env.SHOPIFY_SHOP_DOMAIN = shop;
  process.env.SHOPIFY_CLIENT_ID = "test-client";
  process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
  globalThis.fetch = async (input, init) => {
    const request = new URL(String(input));
    assert.equal(request.hostname, shop);
    if (request.pathname === "/admin/oauth/access_token") {
      return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    }
    assert.match(request.pathname, /\/graphql\.json$/);
    const { query, variables } = JSON.parse(String(init?.body));
    assert.match(query, /^\s*query CollectionProducts\b/);
    assert.equal(variables.id, collectionId);
    const index = variables.after ? 1 : 0;
    return Response.json({ data: { collection: {
      id: collectionId,
      legacyResourceId: "1",
      title: "New sale",
      handle: "sale",
      sortOrder: "MANUAL",
      productsCount: { count: pages.flat().length },
      products: {
        nodes: pages[index],
        pageInfo: { hasNextPage: index === 0, endCursor: index === 0 ? "page-2" : null },
      },
    } } });
  };
  ({ prisma } = await import("../lib/prisma"));
  routes = await import("../app/api/collection-rotation/control/route");
  const pin = (zone: string, position: number, item: ReturnType<typeof product>) => ({
    zone, position, shopifyProductId: item.id, productTitle: item.title, productHandle: item.handle,
  });
  await prisma.collectionRotation.create({ data: {
    shop, shopifyCollectionId: collectionId, collectionTitle: "Old sale", collectionHandle: "sale",
    controlledTopCount: 2, controlledBottomCount: 2,
    controlledProducts: { create: [
      pin("TOP", 1, oldTop), pin("TOP", 2, keptTop),
      pin("BOTTOM", 1, oldBottom), pin("BOTTOM", 2, keptBottom),
    ] },
  } });
});

after(async () => {
  await prisma?.$disconnect();
  await socket?.stop();
  await db?.close();
  globalThis.fetch = originalFetch;
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function save(body: Record<string, unknown>) {
  return routes.POST(new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collectionId, ...body }),
  }));
}

function savedPins() {
  return prisma.collectionControlledProduct.findMany({
    orderBy: [{ zone: "desc" }, { position: "asc" }],
    select: { zone: true, position: true, shopifyProductId: true },
  });
}

test("the editor opens reused sale slots without hidden stale pins, then saves a valid replacement", async () => {
  const original = await savedPins();
  const response = await routes.GET(new NextRequest(url));
  assert.equal(response.status, 200);
  const editor = await response.json();
  assert.equal(editor.controlledTopCount, 2);
  assert.equal(editor.controlledBottomCount, 2);
  assert.deepEqual(editor.assignments, [{ position: 2, productId: keptTop.id }]);
  assert.deepEqual(editor.bottomAssignments, [{ position: 2, productId: keptBottom.id }]);
  assert.deepEqual(await savedPins(), original, "opening the editor never changes saved pins");

  const saved = await save({
    ...editor,
    assignments: [{ position: 1, productId: clownfish.id }, ...editor.assignments],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await savedPins(), [
    { zone: "TOP", position: 1, shopifyProductId: clownfish.id },
    { zone: "TOP", position: 2, shopifyProductId: keptTop.id },
    { zone: "BOTTOM", position: 2, shopifyProductId: keptBottom.id },
  ]);
});

test("if membership changes after opening, saving identifies the affected slot without writing", async () => {
  const response = await routes.GET(new NextRequest(url));
  assert.equal(response.status, 200);
  const editor = await response.json();
  assert.ok(editor.products.some((item: { id: string }) => item.id === extra.id));
  const original = await savedPins();
  pages = [[clownfish], [keptTop, keptBottom, product(7, "Another product")]];
  try {
    const result = await save({
      ...editor,
      assignments: [
        { position: 1, productId: extra.id },
        ...editor.assignments.filter((pin: { position: number }) => pin.position !== 1),
      ],
    });
    assert.equal(result.status, 409);
    assert.match((await result.json()).error, /top position 1.*Reopen Fixed product positions/);
    assert.deepEqual(await savedPins(), original);
  } finally {
    pages = [[clownfish, extra], [keptTop, keptBottom]];
  }
});
