import test from "node:test";
import assert from "node:assert/strict";
import { macroalgaeGraphql } from "../lib/macroalgae-shopify";
import { ShopifyRequestNotExecutedError } from "../lib/shopify-request-error";

const query = "query MacroClientTransportTest { __typename }";
let testClock = Date.now();
async function isolated(name: string, run: () => Promise<void>) {
  const keys = ["SPECIES_LIBRARY_SHOP_DOMAIN", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"];
  const previous = keys.map(key => process.env[key]), fetch = globalThis.fetch, now = Date.now;
  // Expire the existing singleton cache between cases without exporting test-only state.
  const at = testClock += 14400000;
  Date.now = () => at;
  Object.assign(process.env, { SPECIES_LIBRARY_SHOP_DOMAIN: `macroalgaefarms-client-${name}.myshopify.com`,
    MACROALGAE_SHOPIFY_CLIENT_ID: "macro-client-fixture", MACROALGAE_SHOPIFY_CLIENT_SECRET: "private-fixture-secret" });
  try { await run(); } finally {
    globalThis.fetch = fetch; Date.now = now;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
}

test("Macro authentication HTML errors are safe, coalesced and recover on the next attempt", async () => isolated("auth-html", async () => {
  let auth = 0, api = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/oauth/access_token")) return ++auth === 1
      ? new Response("<!DOCTYPE html><p>private-fixture-secret upstream detail</p>", { status: 503 })
      : Response.json({ access_token: "recovered-token", expires_in: 600 });
    api++;
    return Response.json({ data: { __typename: "QueryRoot" } });
  };
  const failures = await Promise.allSettled([macroalgaeGraphql(query), macroalgaeGraphql(query)]);
  for (const result of failures) {
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") throw Error("Authentication must fail before an API request.");
    assert.ok(result.reason instanceof ShopifyRequestNotExecutedError);
    assert.match(String(result.reason), /Macroalgae Shopify authentication.*HTTP 503.*non-JSON/);
    assert.doesNotMatch(String(result.reason), /private-fixture-secret|upstream detail|DOCTYPE/);
  }
  assert.equal(auth, 1); assert.equal(api, 0);
  assert.deepEqual(await macroalgaeGraphql(query), { data: { __typename: "QueryRoot" } });
  assert.equal(auth, 2); assert.equal(api, 1);
}));

test("Macro authentication rejects invalid JSON shapes and missing tokens without poisoning retries", async () => isolated("auth-shape", async () => {
  const bodies = [null, [], {}, { access_token: 123 }];
  let auth = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/oauth/access_token")) return Response.json(auth < bodies.length
      ? bodies[auth++] : { access_token: "valid-token", expires_in: 600 });
    return Response.json({ data: { __typename: "QueryRoot" } });
  };
  for (let index = 0; index < bodies.length; index++)
    await assert.rejects(macroalgaeGraphql(query), index < 2 ? /authentication.*HTTP 200.*invalid response/ : /authentication response did not include an access token/);
  assert.deepEqual(await macroalgaeGraphql(query), { data: { __typename: "QueryRoot" } });
}));

test("Macro API HTML and GraphQL errors keep a good token and never expose raw messages", async () => isolated("api-errors", async () => {
  let auth = 0, api = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/oauth/access_token")) { auth++; return Response.json({ access_token: "good-token", expires_in: 600 }); }
    if (++api === 1) return new Response("<!DOCTYPE html><p>private API error body</p>", { status: 502 });
    if (api === 2) return Response.json({ errors: [{ message: "private customer address in rejected input", extensions: { code: "THROTTLED" } }] });
    return Response.json({ data: { __typename: "QueryRoot" } });
  };
  await assert.rejects(macroalgaeGraphql(query), error => {
    assert.match(String(error), /GraphQL.*HTTP 502.*non-JSON/);
    assert.doesNotMatch(String(error), /private API|DOCTYPE/); return true;
  });
  await assert.rejects(macroalgaeGraphql(query), error => {
    assert.match(String(error), /GraphQL returned errors \(THROTTLED\)/);
    assert.doesNotMatch(String(error), /private customer|rejected input/); return true;
  });
  assert.deepEqual(await macroalgaeGraphql(query), { data: { __typename: "QueryRoot" } });
  assert.equal(auth, 1); assert.equal(api, 3);
}));

test("Macro JSON HTTP failures and invalid API shapes have safe operation context", async () => isolated("http-errors", async () => {
  let auth = 0, api = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/oauth/access_token")) return ++auth === 1
      ? Response.json({ error_description: "private credentials rejected" }, { status: 403 })
      : Response.json({ access_token: "good-token", expires_in: 600 });
    if (++api === 1) return Response.json({ privateDetails: "private API payload" }, { status: 500 });
    if (api === 2) return Response.json(null);
    return Response.json({ data: { __typename: "QueryRoot" } });
  };
  await assert.rejects(macroalgaeGraphql(query), /authentication request failed with HTTP 403\.$/);
  await assert.rejects(macroalgaeGraphql(query), /GraphQL request failed with HTTP 500\.$/);
  await assert.rejects(macroalgaeGraphql(query), /GraphQL returned HTTP 200 with an invalid response\.$/);
  assert.deepEqual(await macroalgaeGraphql(query), { data: { __typename: "QueryRoot" } });
  assert.equal(auth, 2);
}));

test("a late Macro 401 cannot discard an already refreshed token", async () => isolated("late-401", async () => {
  let auth = 0, api = 0, rejected = 0;
  let release!: () => void;
  const late = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/oauth/access_token")) return Response.json({ access_token: "token-" + ++auth, expires_in: 600 });
    api++;
    if ((init?.headers as Record<string, string>)["X-Shopify-Access-Token"] === "token-1") {
      if (++rejected === 2) await late;
      return new Response("Unauthorized", { status: 401 });
    }
    return Response.json({ data: { __typename: "QueryRoot" } });
  };
  const first = macroalgaeGraphql(query), second = macroalgaeGraphql(query);
  await first;
  release(); await second;
  assert.equal(auth, 2, "The delayed response reuses the refreshed token.");
  assert.equal(api, 4, "Each rejected API call is retried once.");
}));

test("Macro rejects pre-execution costs safely while partial responses and network outcomes remain uncertain", async () => isolated("cost-not-executed", async () => {
  for (const [body, knownNonExecution] of [
    [{ errors: [{ extensions: { code: "THROTTLED" } }] }, true],
    [{ data: null, errors: [{ extensions: { code: "MAX_COST_EXCEEDED" } }] }, true],
    [{ data: { partial: true }, errors: [{ extensions: { code: "THROTTLED" } }] }, false],
    [{ errors: [{ path: ["discountCodeBasicCreate"], extensions: { code: "THROTTLED" } }] }, false],
    [{ errors: [{ extensions: { code: "THROTTLED" } }, { extensions: { code: "INTERNAL_SERVER_ERROR" } }] }, false],
  ] as const) {
    globalThis.fetch = async url => String(url).endsWith("/oauth/access_token")
      ? Response.json({ access_token: "cost-fixture", expires_in: 600 }) : Response.json(body);
    await assert.rejects(macroalgaeGraphql(query), error => {
      assert.equal(error instanceof ShopifyRequestNotExecutedError, knownNonExecution); return true;
    });
  }
  globalThis.fetch = async () => { throw Error("Unknown connection reset after POST"); };
  await assert.rejects(macroalgaeGraphql(query), error => {
    assert.ok(!(error instanceof ShopifyRequestNotExecutedError)); return true;
  });
}));
