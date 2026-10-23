import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "./cart-launch.integration";
import { runWithMarketingBrand } from "../lib/marketing/context";
import { macroSubscriberList } from "../lib/marketing/macro-subscriber-eligibility";

const customer = (id: string, address: string | null, state = "SUBSCRIBED", dated = true) => ({
  id: "gid://shopify/Customer/" + id, firstName: "Macro", lastName: "Customer", updatedAt: new Date().toISOString(),
  defaultEmailAddress: address ? { emailAddress: address, marketingState: state,
    marketingUpdatedAt: dated ? new Date(Date.now() - 60000).toISOString() : null } : null,
});
const page = (nodes: ReturnType<typeof customer>[], next: string | null = null) => ({ data: {
  customers: { nodes, pageInfo: { hasNextPage: !!next, endCursor: next } },
} });
type Harness = Context & {
  macroShop: string;
  requests: { after: string | null }[];
  respond: (value: unknown | (() => Promise<unknown>)) => void;
  profile: (address: string, id: string, suppressed?: boolean) => Promise<{ id: string; email: string | null }>;
};

async function isolated(context: Context, name: string, work: (h: Harness) => Promise<void>) {
  const keys = ["SPECIES_LIBRARY_SHOP_DOMAIN", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"];
  const previous = keys.map(key => process.env[key]), oldFetch = globalThis.fetch;
  const macroShop = `macroalgaefarms-${name}.myshopify.com`, requests: Harness["requests"] = [];
  Object.assign(process.env, { SPECIES_LIBRARY_SHOP_DOMAIN: macroShop, MACROALGAE_SHOPIFY_CLIENT_ID: "macro-test",
    MACROALGAE_SHOPIFY_CLIENT_SECRET: "macro-test-secret" });
  let response: unknown | (() => Promise<unknown>) = page([]);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith(`https://${macroShop}/`), "subscriber sync cannot contact Corals or an email provider");
    if (url.endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "macro-test", expires_in: 3600 });
    assert.ok(url.endsWith("/admin/api/2026-07/graphql.json"));
    const body = JSON.parse(String(init?.body));
    assert.match(body.query, /MarketingShopifySubscribers/);
    assert.doesNotMatch(body.query, /orders|addresses|phone|images|descriptionHtml/);
    requests.push(body.variables);
    return Response.json(typeof response === "function" ? await response() : response);
  };
  try {
    await runWithMarketingBrand("macroalgae-farms", async () => {
      const profile: Harness["profile"] = async (address, id, suppressed) => context.store.atomic(async tx => {
        const p = await context.store.identify(tx, { email: address, shopifyId: id });
        await context.store.consent(tx, p.id, "EMAIL", suppressed ? "UNSUBSCRIBED" : "SUBSCRIBED", suppressed ? "provider" : "test",
          new Date(Date.now() - 120000), suppressed ? "COMPLAINED" : undefined);
        await tx.marketingProfile.update({ where: { id: p.id }, data: { lists: [macroSubscriberList], properties: {
          shopifyEmailConsent: { state: "SUBSCRIBED", checkedAt: new Date(Date.now() - 120000).toISOString() },
        } } });
        return p;
      });
      await work({ ...context, macroShop, requests, respond: value => { response = value; }, profile });
    });
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
}

export function registerMacroSubscriberTests(context: () => Context) {
  test("Macro subscribers: separate seed, subscribed-only profiles, source proof and sticky suppression", async () => isolated(context(), "seed", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed");
    const sync = await import("../lib/marketing/shopify-subscribers");
    const audience = await import("../lib/marketing/campaign-audience");
    const shared = "shared-macro-seed@example.com";
    const corals = await runWithMarketingBrand("corals-anonymous", () => h.store.atomic(async tx => {
      const p = await h.store.identify(tx, { email: shared });
      await h.store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "provider", new Date(), "BOUNCED");
      return tx.marketingProfile.findUniqueOrThrow({ where: { id: p.id }, include: { consents: true } });
    }));
    await seedMacroMarketing(); await seedMacroMarketing();
    const resources = await h.prisma.marketingResource.findMany({ where: { shop: h.macroShop } });
    assert.deepEqual(resources.map(row => row.kind).sort(), ["SEGMENT", "SETTINGS", "TEMPLATE"]);
    assert.doesNotMatch(JSON.stringify(resources), /Corals Anonymous|coralsanonymous\.com|Rr5yRa|klaviyoMailable/);
    const settings = resources.find(row => row.kind === "SETTINGS")!.data as { operations: Record<string, boolean> };
    assert.ok(Object.values(settings.operations).every(value => value === false));
    const blocked = await h.profile("blocked-macro@example.com", "2", true);
    const pending = await h.profile("pending-macro@example.com", "3");
    const removed = await h.profile("removed-macro@example.com", "6");
    const missing = await h.profile("missing-macro@example.com", "7");
    const spoof = await h.profile("csv-list-name@example.com", "8");
    await h.prisma.marketingProfile.update({ where: { id: spoof.id }, data: { properties: {} } });
    h.respond(page([
      customer("1", shared), customer("2", blocked.email), customer("3", pending.email, "PENDING"),
      customer("4", "irrelevant-unsubscribed@example.com", "UNSUBSCRIBED"),
      customer("5", "missing-date@example.com", "SUBSCRIBED", false), customer("6", null),
    ], "next-page"));
    assert.equal((await sync.setShopifySubscriberSyncRunning(true)).running, true);
    let status = await sync.syncShopifySubscribers();
    assert.equal(status.checked, 6); assert.equal(status.imported, 1); assert.equal(status.suppressed, 1);
    assert.equal(status.errors, 1); assert.equal(status.phase, "customers");
    assert.equal(await h.prisma.marketingProfile.count({ where: { shop: h.macroShop, email: { in: ["irrelevant-unsubscribed@example.com", "missing-date@example.com"] } } }), 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.macroShop } }), 0);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.macroShop, kind: { in: ["FLOW", "WELCOME_RUN", "WELCOME_COUPON"] } } }), 0);
    await sync.setShopifySubscriberSyncRunning(false);
    await sync.syncShopifySubscribers(); assert.equal(h.requests.length, 1, "paused work does not read another page");
    h.respond(page([customer("9", "second-macro@example.com")]));
    await sync.setShopifySubscriberSyncRunning(true); status = await sync.syncShopifySubscribers();
    assert.equal(status.phase, "complete"); assert.equal(status.running, false); assert.equal(status.imported, 2);
    assert.equal(h.requests[1].after, "next-page");
    for (const id of [blocked.id, pending.id, removed.id, missing.id]) {
      const p = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id } });
      assert.ok(!p.lists.includes(macroSubscriberList));
    }
    const resolved = await audience.resolveCampaignAudience(h.prisma, { version: 2, includeKeys: [], excludeKeys: [] });
    const mailable = await h.prisma.marketingProfile.findMany({ where: audience.resolvedAudienceWhere(resolved), include: { consents: true } });
    assert.deepEqual(mailable.map(p => p.email).sort(), [shared, "second-macro@example.com"].sort());
    for (const p of mailable) assert.equal(audience.campaignConsentEligible(p, resolved), true);
    const fake = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: spoof.id }, include: { consents: true } });
    assert.equal(audience.campaignConsentEligible(fake, resolved), false, "a CSV list name cannot impersonate Shopify consent proof");
    assert.equal(audience.resolvedAudienceMatches(fake, resolved), false);
    assert.deepEqual(await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: corals.id }, include: { consents: true } }), corals,
      "the same email's Corals profile and suppression remain unchanged");
  }));

  test("Macro subscribers: PENDING temporarily removes eligibility, actual opt-outs remain suppressed", async () => isolated(context(), "states", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    const p = await h.profile("state-changes@example.com", "11");
    for (const state of ["PENDING", "SUBSCRIBED", "UNSUBSCRIBED", "SUBSCRIBED"]) {
      h.respond(page([customer("11", p.email, state)]));
      await sync.setShopifySubscriberSyncRunning(true); await sync.syncShopifySubscribers();
      const saved = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id }, include: { consents: true } });
      assert.equal(saved.lists.includes(macroSubscriberList), state === "SUBSCRIBED" && !saved.consents[0].suppressed);
      assert.equal((saved.properties as { shopifyEmailConsent: { state: string } }).shopifyEmailConsent.state, state);
      if (state === "PENDING") assert.equal(saved.consents[0].status, "SUBSCRIBED", "uncertain Shopify states do not invent an opt-out");
    }
    const final = await h.prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } } });
    assert.equal(final.status, "UNSUBSCRIBED"); assert.equal(final.suppressed, true);
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.macroShop } }), 0);
  }));

  test("Macro subscribers: failed pages preserve checkpoints and cannot prune unseen subscribers", async () => isolated(context(), "retry", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    const retained = await h.profile("not-yet-seen@example.com", "20");
    h.respond(page([customer("21", "first-page@example.com")], "cursor-1"));
    await sync.setShopifySubscriberSyncRunning(true); await sync.syncShopifySubscribers();
    h.respond({ data: { customers: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } } } });
    const failed = await sync.syncShopifySubscribers();
    assert.equal(failed.running, false); assert.match(failed.error!, /pagination did not advance/);
    assert.equal(failed.checked, 1);
    assert.ok((await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: retained.id } })).lists.includes(macroSubscriberList));
    h.respond(page([customer("20", retained.email)]));
    await sync.setShopifySubscriberSyncRunning(true); const completed = await sync.syncShopifySubscribers();
    assert.equal(completed.phase, "complete"); assert.equal(completed.checked, 2);
    assert.equal(h.requests.at(-1)!.after, "cursor-1");
    assert.ok((await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: retained.id } })).lists.includes(macroSubscriberList));
  }));

  test("Macro subscribers: a pause during Shopify lookup survives the page checkpoint", async () => isolated(context(), "pause", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    let release!: (value: unknown) => void, began!: () => void;
    const called = new Promise<void>(resolve => { began = resolve; });
    h.respond(() => { began(); return new Promise(resolve => { release = resolve; }); });
    await sync.setShopifySubscriberSyncRunning(true);
    const inFlight = sync.syncShopifySubscribers(); await called;
    await sync.setShopifySubscriberSyncRunning(false);
    const requests = h.requests.length;
    assert.equal((await sync.syncShopifySubscribers()).running, false, "a second worker cannot claim the leased page");
    assert.equal(h.requests.length, requests);
    release(page([customer("31", "paused-page@example.com")], "later"));
    const status = await inFlight;
    assert.equal(status.running, false); assert.equal(status.checked, 1); assert.equal(status.phase, "customers");
  }));

  test("Macro subscribers: authenticated consent updates immediately change membership and ignore stale states", async () => isolated(context(), "events", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const p = await h.profile("webhook-macro@example.com", "41");
    const start = Date.now() - 60000;
    const update = (state: string, offset: number, label = state) => {
      const at = new Date(start + offset).toISOString();
      return h.ingest.ingestShopify("customers_email_marketing_consent/update", `macro-consent-${label}`, {
        customer_id: "41", email_address: p.email!, updated_at: at,
        email_marketing_consent: { state: state.toLowerCase(), consent_updated_at: at },
      });
    };
    const saved = () => h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id }, include: { consents: true } });
    await update("PENDING", 10000);
    assert.ok(!(await saved()).lists.includes(macroSubscriberList));
    await update("SUBSCRIBED", 5000, "stale-subscribe");
    assert.ok(!(await saved()).lists.includes(macroSubscriberList));
    await update("SUBSCRIBED", 20000);
    assert.ok((await saved()).lists.includes(macroSubscriberList));
    await update("UNSUBSCRIBED", 15000, "stale-unsubscribe");
    assert.equal((await saved()).consents[0].suppressed, false, "a delayed older state cannot supersede a newer Shopify observation");
    assert.ok((await saved()).lists.includes(macroSubscriberList));
    await update("UNSUBSCRIBED", 30000);
    assert.equal((await saved()).consents[0].suppressed, true);
    assert.ok(!(await saved()).lists.includes(macroSubscriberList));
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.macroShop } }), 0, "customer consent changes cannot launch Macro flows");
  }));

  test("Macro subscribers: an email identity change cannot be reversed by a delayed old-address event", async () => isolated(context(), "identity", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    const p = await h.profile("old-address@example.com", "51");
    h.respond(page([customer("51", "new-address@example.com")]));
    await sync.setShopifySubscriberSyncRunning(true);
    const result = await sync.syncShopifySubscribers();
    assert.equal(result.errors, 1);
    const before = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(before.email, "old-address@example.com"); assert.ok(!before.lists.includes(macroSubscriberList));
    const at = new Date(Date.now() - 60000).toISOString();
    await h.ingest.ingestShopify("customers_email_marketing_consent/update", "macro-old-address-consent", {
      customer_id: "51", email_address: p.email!, updated_at: at,
      email_marketing_consent: { state: "subscribed", consent_updated_at: at },
    });
    const after = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id } });
    assert.ok(!after.lists.includes(macroSubscriberList));
    assert.equal((after.properties as { shopifyEmailConsent: { state: string } }).shopifyEmailConsent.state, "IDENTITY_REVIEW");
    assert.equal(await h.prisma.marketingProfile.count({ where: { shop: h.macroShop, email: "new-address@example.com" } }), 0);
  }));

  test("Macro subscribers: an in-flight subscribed snapshot cannot undo a newer pending consent webhook", async () => isolated(context(), "snapshot-race", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    const p = await h.profile("snapshot-race@example.com", "61");
    const oldSnapshot = page([customer("61", p.email)]);
    let release!: (value: unknown) => void, began!: () => void;
    const called = new Promise<void>(resolve => { began = resolve; });
    h.respond(() => { began(); return new Promise(resolve => { release = resolve; }); });
    await sync.setShopifySubscriberSyncRunning(true);
    const inFlight = sync.syncShopifySubscribers(); await called;
    const at = new Date(Date.now() - 5000).toISOString();
    await h.ingest.ingestShopify("customers_email_marketing_consent/update", "macro-inflight-pending", {
      customer_id: "61", email_address: p.email!, updated_at: at,
      email_marketing_consent: { state: "pending", consent_updated_at: at },
    });
    const current = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id }, include: { consents: true } });
    assert.equal(current.consents[0].status, "SUBSCRIBED", "pending state deliberately preserves the prior consent record");
    assert.ok(!current.lists.includes(macroSubscriberList));
    release(oldSnapshot);
    const result = await inFlight;
    assert.equal(result.phase, "complete"); assert.equal(result.skipped, 1);
    const after = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id }, include: { consents: true } });
    assert.deepEqual(after.properties, current.properties, "the captured old page cannot rewrite newer source evidence");
    assert.ok(!after.lists.includes(macroSubscriberList));
    assert.deepEqual(after.consents, current.consents, "old snapshot eligibility is checked before any consent update");
    const audience = await import("../lib/marketing/campaign-audience");
    const resolved = await audience.resolveCampaignAudience(h.prisma, { version: 2, includeKeys: [], excludeKeys: [] });
    assert.equal(audience.campaignConsentEligible(after, resolved), false);
    assert.equal(await h.prisma.marketingProfile.count({ where: audience.resolvedAudienceWhere(resolved) }), 0);
  }));

  test("Macro subscribers: sweep completion preserves a subscriber added by a newer webhook", async () => isolated(context(), "prune-race", async h => {
    const { seedMacroMarketing } = await import("../lib/marketing/macro-seed"); await seedMacroMarketing();
    const sync = await import("../lib/marketing/shopify-subscribers");
    const missing = await h.profile("old-missing-shopify@example.com", "71");
    let release!: (value: unknown) => void, began!: () => void;
    const called = new Promise<void>(resolve => { began = resolve; });
    h.respond(() => { began(); return new Promise(resolve => { release = resolve; }); });
    await sync.setShopifySubscriberSyncRunning(true);
    const inFlight = sync.syncShopifySubscribers(); await called;
    const at = new Date(Date.now() - 5000).toISOString();
    await h.ingest.ingestShopify("customers_email_marketing_consent/update", "macro-new-during-sweep", {
      customer_id: "72", email_address: "new-during-sweep@example.com", updated_at: at,
      email_marketing_consent: { state: "subscribed", consent_updated_at: at },
    });
    const added = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { shop_email: { shop: h.macroShop, email: "new-during-sweep@example.com" } } });
    assert.ok(added.lists.includes(macroSubscriberList));
    release(page([])); await inFlight;
    const after = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: added.id } });
    assert.deepEqual(after.properties, added.properties);
    assert.ok(after.lists.includes(macroSubscriberList), "completion cannot prune source evidence recorded after the sweep started");
    const removed = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: missing.id } });
    assert.ok(!removed.lists.includes(macroSubscriberList), "older genuinely missing subscribers are still pruned");
    assert.equal((removed.properties as { shopifyEmailConsent: { state: string } }).shopifyEmailConsent.state, "NOT_FOUND");
  }));
}
