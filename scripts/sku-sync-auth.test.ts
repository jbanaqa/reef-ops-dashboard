import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isSkuSyncAuthorized } from "../lib/sku-sync/auth";
import { proxy } from "../proxy";

const names = ["DATABASE_URL", "DASHBOARD_USERNAME", "DASHBOARD_PASSWORD", "DASHBOARD_AUTH_DISABLED", "MARKETING_UNSUBSCRIBE_ORIGIN",
  "SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SPECIES_LIBRARY_SHOP_DOMAIN",
  "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET", "SKU_SYNC_MAPPINGS_URL",
  "APP_BASE_URL", "REEF_OPS_PUBLIC_URL", "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_SERVICE_REEF_OPS_DASHBOARD_URL"];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
let routes: typeof import("../app/api/sku-sync/route");
const authorization = "Basic " + Buffer.from("staff:test-password:with-colon").toString("base64");

before(async () => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never-connect";
  process.env.DASHBOARD_USERNAME = "staff";
  process.env.DASHBOARD_PASSWORD = "test-password:with-colon";
  process.env.DASHBOARD_AUTH_DISABLED = "false";
  delete process.env.MARKETING_UNSUBSCRIBE_ORIGIN;
  delete process.env.SKU_SYNC_MAPPINGS_URL;
  process.env.SHOPIFY_SHOP_DOMAIN = "sku-auth-test.myshopify.com";
  process.env.SPECIES_LIBRARY_SHOP_DOMAIN = "macroalgaefarms-sku-test.myshopify.com";
  for (const name of ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"]) process.env[name] = "test-only";
  globalThis.fetch = async () => { throw new Error("Auth tests must never reach an external service."); };
  routes = await import("../app/api/sku-sync/route");
});
after(async () => {
  const { prisma } = await import("../lib/prisma");
  await prisma.$disconnect();
  for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  globalThis.fetch = originalFetch;
});
function request(headers: Record<string, string> = {}, body?: string, origin = "https://reef.example") {
  return new Request(`${origin}/api/sku-sync`, { method: body === undefined ? "GET" : "POST", headers, body });
}
test("public dashboard SKU reads and writes do not require a login", async () => {
  process.env.DASHBOARD_AUTH_DISABLED = "true";
  delete process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET;
  try {
    assert.equal(isSkuSyncAuthorized(request()), true);
    const get = await routes.GET(request());
    const post = await routes.POST(request({ origin: "https://reef.example", "content-type": "application/json" }, "{}"));
    assert.equal(get.status, 200);
    assert.equal(post.status, 503); // The request reached setup, not an auth gate; no live Shopify calls.
    for (const response of [get, post]) {
      assert.equal(response.headers.get("www-authenticate"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match((await response.json()).error, /MACROALGAE_SHOPIFY_CLIENT_SECRET/);
    }
  } finally {
    process.env.DASHBOARD_AUTH_DISABLED = "false";
    process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET = "test-only";
  }
});
test("SKU Sync respects the existing dashboard login if it is enabled", () => {
  assert.equal(isSkuSyncAuthorized(request()), false);
  assert.equal(isSkuSyncAuthorized(request({ authorization })), true);
  assert.equal(isSkuSyncAuthorized(request({ authorization: "Basic malformed" })), false);
  assert.equal(isSkuSyncAuthorized(request({ authorization: "Basic " + Buffer.from("staff:wrong").toString("base64") })), false);
  const old = process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_PASSWORD;
  assert.equal(isSkuSyncAuthorized(request({ authorization })), false);
  process.env.DASHBOARD_PASSWORD = old;
});
test("cross-site and malformed-origin SKU mutations fail even with staff credentials", async () => {
  assert.equal(isSkuSyncAuthorized(request({ authorization, origin: "https://other.example" }, "{}"), true), false);
  assert.equal(isSkuSyncAuthorized(request({ authorization, origin: "not-a-url" }, "{}"), true), false);
  assert.equal(isSkuSyncAuthorized(request({ authorization, "sec-fetch-site": "cross-site" }, "{}"), true), false);
  assert.equal(isSkuSyncAuthorized(request({ authorization, origin: "https://reef.example" }, "{}"), true), true);
  const response = await routes.POST(request({ authorization, origin: "https://evil.example", "content-type": "application/json" }, "{}"));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("www-authenticate"), null);
});
test("a login-free Railway save accepts the configured public origin, not forwarded headers", async () => {
  process.env.DASHBOARD_AUTH_DISABLED = "true";
  process.env.RAILWAY_PUBLIC_DOMAIN = "reef-example.up.railway.app";
  process.env.RAILWAY_SERVICE_REEF_OPS_DASHBOARD_URL = "reef-alias.up.railway.app";
  process.env.APP_BASE_URL = "https://reef.example";
  process.env.REEF_OPS_PUBLIC_URL = "https://dashboard.example/";
  const post = (origin: string, extra: Record<string, string> = {}) => request({ origin, "content-type": "application/json", ...extra }, "{}", "https://0.0.0.0:8080");
  try {
    for (const origin of ["https://reef-example.up.railway.app", "https://reef-alias.up.railway.app", "https://reef.example", "https://dashboard.example"]) {
      assert.equal(isSkuSyncAuthorized(post(origin), true), true);
      assert.equal((await routes.POST(post(origin))).status, 400); // Reaches field validation.
    }
    assert.equal((await routes.POST(post("https://other.example", { "x-forwarded-host": "other.example", host: "other.example" }))).status, 403);
    assert.equal((await routes.POST(post("null"))).status, 403);
    assert.equal((await routes.POST(post("https://reef.example.other.example"))).status, 403);
    assert.equal((await routes.POST(post("https://reef.example", { "sec-fetch-site": "cross-site" }))).status, 403);
  } finally {
    process.env.DASHBOARD_AUTH_DISABLED = "false";
    for (const name of ["RAILWAY_PUBLIC_DOMAIN", "RAILWAY_SERVICE_REEF_OPS_DASHBOARD_URL", "APP_BASE_URL", "REEF_OPS_PUBLIC_URL"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
});
test("SKU page follows ordinary dashboard access without an additional login prompt", () => {
  assert.equal(proxy(new NextRequest("https://reef.example/sku-sync")).status, 401);
  assert.equal(proxy(new NextRequest("https://reef.example/sku-sync", { headers: { authorization } })).headers.get("x-middleware-next"), "1");
  process.env.DASHBOARD_AUTH_DISABLED = "true";
  try {
    for (const path of ["/sku-sync", "/sku-sync/anything", "/inventory-monitor"]) {
      const response = proxy(new NextRequest(`https://reef.example${path}`));
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("www-authenticate"), null);
    }
  } finally { process.env.DASHBOARD_AUTH_DISABLED = "false"; }
});
test("SKU choices require JSON, current raw SKU strings and exact pair identity", async () => {
  assert.equal((await routes.POST(request({ authorization, "content-type": "text/plain" }, "{}"))).status, 415);
  assert.equal((await routes.POST(request({ authorization, "content-type": "application/json" }, "null"))).status, 400);
  assert.equal((await routes.POST(request({ authorization, "content-type": "application/json" }, "[]"))).status, 400);
  assert.equal((await routes.POST(request({ authorization, "content-type": "application/json" }, "{"))).status, 400);
  assert.equal((await routes.POST(request({ authorization, "content-type": "application/json" }, JSON.stringify({ mappingId: "1", source: "A", expectedSkuA: "x", expectedSkuB: "y" })))).status, 400);
});
test("missing Shopify configuration is a safe setup response, not an external request", async () => {
  delete process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET;
  try {
    const result = await routes.GET(request({ authorization }));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.configured, false);
    assert.deepEqual(body.mappings, []);
    assert.match(body.error, /MACROALGAE_SHOPIFY_CLIENT_SECRET/);
    assert.equal(JSON.stringify(body).includes("test-only"), false);
  } finally { process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET = "test-only"; }
});
