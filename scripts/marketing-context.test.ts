import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { currentMarketingBrand, marketingBrandForShop, marketingEnv, marketingShop, runWithMarketingBrand } from "../lib/marketing/context";
import { setup, resendProvider } from "../lib/marketing/delivery";
import { shopifyGraphql } from "../lib/marketing/shopify";
import { defaultMacroCampaignContent } from "../lib/marketing/brands";

const fixture = {
  SHOPIFY_SHOP_DOMAIN: "corals-fixture.myshopify.com",
  SHOPIFY_CLIENT_ID: "corals-client", SHOPIFY_CLIENT_SECRET: "corals-secret",
  SPECIES_LIBRARY_SHOP_DOMAIN: "macroalgaefarms.myshopify.com",
  MACROALGAE_SHOPIFY_CLIENT_ID: "macro-client", MACROALGAE_SHOPIFY_CLIENT_SECRET: "macro-secret",
  RESEND_API_KEY: "fixture-shared-provider", RESEND_FROM_EMAIL: "Corals Legacy <mail@corals.example>",
  RESEND_WEBHOOK_SECRET: "fixture-webhook", APP_BASE_URL: "https://dashboard.example",
  MARKETING_SEND_ENABLED: "true", MARKETING_MIGRATION_CONFIRMED: "true", MARKETING_INGEST_ENABLED: "true", MARKETING_FORM_ENABLED: "true",
};

async function withFixture(fn: () => Promise<void>) {
  const names = [...new Set([...Object.keys(fixture), ...Object.keys(fixture).map(name => `MACROALGAE_${name}`),
    "MACROALGAE_RESEND_FROM_EMAIL", "MACROALGAE_MARKETING_POSTAL_ADDRESS", "MACROALGAE_MARKETING_UNSUBSCRIBE_ORIGIN", "MARKETING_POSTAL_ADDRESS", "MARKETING_UNSUBSCRIBE_ORIGIN"])] ;
  const previous = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, fixture);
  try { await fn(); } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

test("marketing store context remains isolated across overlapping async work and nested scopes", async () => withFixture(async () => {
  assert.equal(currentMarketingBrand(), "corals-anonymous");
  const values = await Promise.all([
    runWithMarketingBrand("macroalgae-farms", async () => {
      await new Promise(resolve => setTimeout(resolve, 8));
      assert.equal(currentMarketingBrand(), "macroalgae-farms");
      assert.equal(runWithMarketingBrand("corals-anonymous", marketingShop), fixture.SHOPIFY_SHOP_DOMAIN);
      return marketingShop();
    }),
    runWithMarketingBrand("corals-anonymous", async () => {
      await new Promise(resolve => setTimeout(resolve, 2));
      return marketingShop();
    }),
  ]);
  assert.deepEqual(values, [fixture.SPECIES_LIBRARY_SHOP_DOMAIN, fixture.SHOPIFY_SHOP_DOMAIN]);
  assert.equal(currentMarketingBrand(), "corals-anonymous");
  assert.equal(marketingBrandForShop(fixture.SPECIES_LIBRARY_SHOP_DOMAIN), "macroalgae-farms");
  assert.equal(marketingBrandForShop(fixture.SHOPIFY_SHOP_DOMAIN), "corals-anonymous");
  assert.equal(marketingBrandForShop("unrelated.myshopify.com"), null);
  process.env.SHOPIFY_SHOP_DOMAIN = fixture.SPECIES_LIBRARY_SHOP_DOMAIN;
  assert.equal(marketingBrandForShop(fixture.SPECIES_LIBRARY_SHOP_DOMAIN), null);
  assert.throws(() => runWithMarketingBrand("macroalgae-farms", marketingShop), /different Shopify shops/);
}));

test("Macro marketing can share provider capability but never inherits Corals sender, address, or active operations", async () => withFixture(async () => {
  process.env.MARKETING_POSTAL_ADDRESS = "Corals address";
  process.env.MARKETING_UNSUBSCRIBE_ORIGIN = "https://corals-unsubscribe.example";
  runWithMarketingBrand("macroalgae-farms", () => {
    assert.equal(marketingEnv("RESEND_API_KEY"), fixture.RESEND_API_KEY);
    assert.equal(marketingEnv("RESEND_WEBHOOK_SECRET"), fixture.RESEND_WEBHOOK_SECRET);
    assert.equal(marketingEnv("APP_BASE_URL"), fixture.APP_BASE_URL);
    assert.equal(marketingEnv("RESEND_FROM_EMAIL"), undefined);
    assert.equal(marketingEnv("MARKETING_POSTAL_ADDRESS"), undefined);
    assert.equal(marketingEnv("MARKETING_UNSUBSCRIBE_ORIGIN"), undefined);
    assert.equal(setup(undefined, "Macro address").sendingEnabled, false);
    assert.equal(setup(undefined, "Macro address").ingestEnabled, false);
    assert.equal(setup(undefined, "Macro address").emailReady, false);
    const saved = { sendingEnabled: true, migrationConfirmed: true, ingestEnabled: true, formEnabled: false };
    assert.equal(setup(saved, "Macro address", { email: "hello@macroalgaefarms.com" }).emailReady, true);
    assert.equal(setup(saved, "Macro address", { email: "hello@macroalgaefarms.com" }).sendingEnabled, true);
    process.env.MACROALGAE_MARKETING_SEND_ENABLED = "false";
    assert.equal(setup(saved, "Macro address", { email: "hello@macroalgaefarms.com" }).sendingEnabled, false);
  });
  assert.equal(setup().senderEmail, "mail@corals.example");
  assert.equal(setup().senderName, "Corals Legacy");
  process.env.MACROALGAE_RESEND_FROM_EMAIL = "Macro Environment <hello@macroalgaefarms.com>";
  runWithMarketingBrand("macroalgae-farms", () => {
    assert.equal(setup().senderEmail, "hello@macroalgaefarms.com", "email inputs receive only the mailbox");
    assert.equal(setup().senderName, "Macro Environment");
    assert.equal(setup(undefined, "Macro address", { name: "Saved Macro Name" }).senderEmail, "hello@macroalgaefarms.com");
    assert.equal(setup(undefined, "Macro address", { name: "Saved Macro Name" }).senderName, "Saved Macro Name");
  });
}));

test("marketing Shopify transport selects the scoped shop and its own credentials", async () => withFixture(async () => {
  const previous = globalThis.fetch;
  const calls: { url: string; client?: string; token?: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/admin/oauth/access_token")) {
      const client = new URLSearchParams(String(init?.body)).get("client_id")!;
      calls.push({ url, client });
      return Response.json({ access_token: `token-${client}`, expires_in: 3600 });
    }
    calls.push({ url, token: new Headers(init?.headers).get("X-Shopify-Access-Token")! });
    return Response.json({ data: { shop: { id: new URL(url).hostname } } });
  };
  try {
    const results = await Promise.all([
      runWithMarketingBrand("corals-anonymous", () => shopifyGraphql<{ data: { shop: { id: string } } }>("query MarketingContextShop { shop { id } }")),
      runWithMarketingBrand("macroalgae-farms", () => shopifyGraphql<{ data: { shop: { id: string } } }>("query MarketingContextShop { shop { id } }")),
    ]);
    assert.deepEqual(results.map(result => result.data.shop.id), [fixture.SHOPIFY_SHOP_DOMAIN, fixture.SPECIES_LIBRARY_SHOP_DOMAIN]);
    for (const call of calls) {
      const macro = new URL(call.url).hostname === fixture.SPECIES_LIBRARY_SHOP_DOMAIN;
      if (call.client) assert.equal(call.client, macro ? "macro-client" : "corals-client");
      if (call.token) assert.equal(call.token, macro ? "token-macro-client" : "token-corals-client");
    }
  } finally { globalThis.fetch = previous; }
}));

test("Macro delivery requires its own sender and passes saved sender name and reply-to without Corals branding", async () => withFixture(async () => {
  const previous = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const dns = mock.method(Resolver.prototype, "resolveMx", async () => [{ priority: 10, exchange: "mx.fixture.example" }]);
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "fixture-provider-id" });
  };
  const message = { id: "fixture-message", to: "recipient@example.com", channel: "EMAIL", subject: "Macro arrivals",
    content: defaultMacroCampaignContent, unsubscribe: "https://dashboard.example/unsubscribe", address: "Macro address" };
  try {
    await runWithMarketingBrand("macroalgae-farms", async () => {
      await assert.rejects(() => resendProvider.send(message), /sender and postal address/);
      assert.equal(requests.length, 0);
      await resendProvider.send({ ...message, sender: { name: "Macroalgae Farms", email: "hello@macroalgaefarms.com", replyTo: "help@macroalgaefarms.com" } });
    });
    assert.equal(requests[0].from, "Macroalgae Farms <hello@macroalgaefarms.com>");
    assert.equal(requests[0].reply_to, "help@macroalgaefarms.com");
    assert.match(String(requests[0].html), /Macroalgae Farms/);
    assert.doesNotMatch(String(requests[0].html), /Corals Anonymous|coralsanonymous\.com/);
    assert.deepEqual(requests[0].tags, [
      { name: "marketing_message", value: message.id }, { name: "marketing_brand", value: "macroalgae-farms" },
    ]);
    await runWithMarketingBrand("corals-anonymous", () => resendProvider.send(message));
    assert.equal(requests[1].from, fixture.RESEND_FROM_EMAIL);
  } finally { globalThis.fetch = previous; dns.mock.restore(); }
}));
