import test from "node:test";
import assert from "node:assert/strict";
import { getShopifyAccessToken, shopifyGraphql } from "../lib/shopify";

const query = "query ClientTransportTest { __typename }";
async function isolated(name: string, run: () => Promise<void>) {
  const keys = ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"];
  const previous = keys.map(key => process.env[key]), fetch = globalThis.fetch, now = Date.now;
  Object.assign(process.env, { SHOPIFY_SHOP_DOMAIN: `client-${name}.myshopify.com`,
    SHOPIFY_CLIENT_ID: "client-fixture", SHOPIFY_CLIENT_SECRET: "secret-fixture" });
  try { await run(); } finally {
    globalThis.fetch = fetch; Date.now = now;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
}

test("Shopify client reuses and coalesces unexpired authentication, refreshing before expiry", async () => isolated("reuse", async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ access_token: "token-" + ++calls, expires_in: 600 });
  assert.deepEqual(await Promise.all([getShopifyAccessToken(), getShopifyAccessToken(), getShopifyAccessToken()]), ["token-1", "token-1", "token-1"]);
  assert.equal(await getShopifyAccessToken(), "token-1"); assert.equal(calls, 1);
  const later = Date.now() + 550000; Date.now = () => later;
  assert.equal(await getShopifyAccessToken(), "token-2"); assert.equal(calls, 2);
}));

test("Shopify client caches each store and credential identity separately", async () => isolated("scope", async () => {
  const requests: string[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push(String(url) + ":" + String(init?.body));
    return Response.json({ access_token: "token-" + requests.length, expires_in: 600 });
  };
  assert.equal(await getShopifyAccessToken(), "token-1");
  process.env.SHOPIFY_SHOP_DOMAIN = "client-other.myshopify.com";
  assert.equal(await getShopifyAccessToken(), "token-2");
  process.env.SHOPIFY_SHOP_DOMAIN = "client-scope.myshopify.com";
  assert.equal(await getShopifyAccessToken(), "token-1");
  process.env.SHOPIFY_CLIENT_SECRET = "rotated-fixture";
  assert.equal(await getShopifyAccessToken(), "token-3");
  assert.equal(requests.length, 3);
}));

test("Shopify client does not cache tokens with an unknown lifetime", async () => isolated("unknown-life", async () => {
  let calls = 0;
  globalThis.fetch = async () => Response.json({ access_token: "token-" + ++calls });
  assert.equal(await getShopifyAccessToken(), "token-1");
  assert.equal(await getShopifyAccessToken(), "token-2");
}));

test("Shopify authentication HTML errors include safe status and do not poison the next attempt", async () => isolated("auth-html", async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? new Response("<!DOCTYPE html><p>private-error-detail</p>", { status: 503 })
    : Response.json({ access_token: "recovered", expires_in: 600 });
  await assert.rejects(getShopifyAccessToken(), error => {
    assert.match(String(error), /authentication.*HTTP 503.*non-JSON/);
    assert.doesNotMatch(String(error), /private-error-detail/); return true;
  });
  assert.equal(await getShopifyAccessToken(), "recovered"); assert.equal(calls, 2);
}));

test("Shopify unauthorized API responses invalidate only the rejected cached token", async () => isolated("unauthorized", async () => {
  let auth = 0, api = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/oauth/access_token")) return Response.json({ access_token: "token-" + ++auth, expires_in: 600 });
    assert.equal((init?.headers as Record<string, string>)["X-Shopify-Access-Token"], "token-" + auth);
    return ++api === 1 ? new Response("Unauthorized", { status: 401 }) : Response.json({ data: { __typename: "QueryRoot" } });
  };
  await assert.rejects(shopifyGraphql(query), /GraphQL.*HTTP 401/);
  assert.deepEqual(await shopifyGraphql(query), { data: { __typename: "QueryRoot" } });
  assert.equal(auth, 2); assert.equal(api, 2, "failed requests are never blindly replayed");
}));

test("Shopify API HTML and GraphQL failures remain explicit without losing a good token", async () => isolated("api-errors", async () => {
  let auth = 0, api = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/oauth/access_token")) return Response.json({ access_token: "token-" + ++auth, expires_in: 600 });
    if (++api === 1) return new Response("<!DOCTYPE html><p>upstream error</p>", { status: 502 });
    return Response.json({ errors: [{ message: "Request throttled", extensions: { code: "THROTTLED" } }] });
  };
  await assert.rejects(shopifyGraphql(query), /GraphQL.*HTTP 502.*non-JSON/);
  await assert.rejects(shopifyGraphql(query), /THROTTLED/);
  assert.equal(auth, 1);
}));
