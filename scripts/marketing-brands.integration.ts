import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Context } from "./cart-launch.integration";
import { currentMarketingBrand, runWithMarketingBrand } from "../lib/marketing/context";
import { defaultMacroCampaignContent } from "../lib/marketing/brands";
import { macroSubscriberList } from "../lib/marketing/macro-subscriber-eligibility";

export function registerMarketingBrandWorkerTests(context: () => Context) {
  test("Macro campaign worker keeps same-address Corals data separate and never processes flow or SMS rows", async () => {
    const h = context(), macroShop = "macroalgaefarms-worker.myshopify.com", sharedAddress = "separate-brand-worker@example.com";
    const oldFetch = globalThis.fetch;
    const values = { SPECIES_LIBRARY_SHOP_DOMAIN: macroShop, MACROALGAE_SHOPIFY_CLIENT_ID: "macro-worker-client",
      MACROALGAE_SHOPIFY_CLIENT_SECRET: "macro-worker-secret", MACROALGAE_RESEND_FROM_EMAIL: "",
      MACROALGAE_MARKETING_SEND_ENABLED: "true", MACROALGAE_MARKETING_MIGRATION_CONFIRMED: "true" };
    const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    const bodies: Record<string, unknown>[] = [], shopifyCalls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://api.resend.com/emails") {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ id: crypto.randomUUID() });
      }
      assert.ok(url.startsWith(`https://${macroShop}/`), "Macro work must never request the Corals shop");
      if (url.endsWith("/admin/oauth/access_token")) {
        assert.equal(new URLSearchParams(String(init?.body)).get("client_id"), "macro-worker-client");
        return Response.json({ access_token: "macro-worker-token", expires_in: 3600 });
      }
      const payload = JSON.parse(String(init?.body));
      shopifyCalls.push(payload.query);
      assert.match(payload.query, /MarketingCampaignProducts/, "no automation lookup may run for Macro campaigns");
      return Response.json({ data: { products: { nodes: [{ id: "gid://shopify/Product/991010", title: "Macro product",
        handle: "macro-product", tags: [], createdAt: new Date().toISOString(), onlineStoreUrl: "https://macroalgaefarms.com/products/macro-product",
        featuredImage: null, variants: { nodes: [{ id: "gid://shopify/ProductVariant/991011", availableForSale: true,
          price: "20.00", compareAtPrice: null, image: null }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    };
    try {
      const corals = await h.store.atomic(async tx => {
        const p = await h.store.identify(tx, { email: sharedAddress });
        await h.store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "fixture", new Date(Date.now() - 60000));
        return p;
      });
      const coralsCampaign = await h.prisma.marketingCampaign.create({ data: { shop: corals.shop, name: "Corals isolation fixture",
        subject: "Corals must stay queued", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000),
        audience: {}, content: h.store.json(defaultMacroCampaignContent) } });
      const coralsMessage = await h.prisma.marketingMessage.create({ data: { shop: corals.shop,
        key: `campaign:${coralsCampaign.id}:${corals.id}`, profileId: corals.id, campaignId: coralsCampaign.id,
        channel: "EMAIL", subject: "Corals must stay queued", content: h.store.json(defaultMacroCampaignContent), dueAt: new Date(Date.now() - 1000) } });
      await runWithMarketingBrand("macroalgae-farms", async () => {
        await h.store.seed();
        await h.prisma.marketingResource.update({ where: { shop_kind_key: { shop: macroShop, kind: "SETTINGS", key: "global" } }, data: { data: {
          organizationName: "Macroalgae Farms", postalAddress: "Macro mailing address",
          sender: { name: "Macroalgae Farms", email: "hello@macroalgaefarms.com", replyTo: "help@macroalgaefarms.com" },
          operations: { sendingEnabled: true, migrationConfirmed: true, ingestEnabled: false, formEnabled: false },
        } } });
        const make = (address: string, subscribed: boolean) => h.store.atomic(async tx => {
          const p = await h.store.identify(tx, { email: address, name: "Macro Subscriber" });
          await h.store.consent(tx, p.id, "EMAIL", subscribed ? "SUBSCRIBED" : "UNSUBSCRIBED", "shopify", new Date(Date.now() - 60000));
          return tx.marketingProfile.update({ where: { id: p.id }, data: { lists: [macroSubscriberList], properties: {
            shopifyEmailConsent: { state: subscribed ? "SUBSCRIBED" : "UNSUBSCRIBED", checkedAt: new Date(Date.now() - 60000).toISOString() },
          } } });
        });
        const macro = await make(sharedAddress, true);
        await make("unsubscribed-brand-worker@example.com", false);
        assert.notEqual(macro.id, corals.id);
        const campaign = await h.prisma.marketingCampaign.create({ data: { shop: macroShop, name: "Macro isolation fixture",
          subject: "Macro arrivals", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000), smartSendingHours: 0,
          audience: { list: macroSubscriberList }, content: h.store.json(defaultMacroCampaignContent) } });
        const flow = await h.prisma.marketingMessage.create({ data: { shop: macroShop, key: "macro-worker-flow-must-stay-paused",
          profileId: macro.id, flowKey: "welcome", flowCondition: "welcome-v1:0", flowStep: 0,
          channel: "EMAIL", subject: "Must not send", content: h.store.json(defaultMacroCampaignContent), dueAt: new Date(Date.now() - 1000) } });
        const sms = await h.prisma.marketingMessage.create({ data: { shop: macroShop, key: "macro-worker-sms-must-stay-paused",
          profileId: macro.id, channel: "SMS_MARKETING", subject: "Must not send", content: h.store.json(defaultMacroCampaignContent), dueAt: new Date(Date.now() - 1000) } });
        const result = await h.worker.runMarketing();
        assert.equal("sent" in result ? result.sent : 0, 1);
        const recipients = await h.prisma.marketingMessage.findMany({ where: { campaignId: campaign.id } });
        assert.equal(recipients.length, 1);
        assert.equal(recipients[0].profileId, macro.id);
        assert.equal(recipients[0].status, "SENT");
        assert.deepEqual(Object.keys(recipients[0].content as object), ["campaignContentRef"], "campaign content stays shared");
        assert.equal((await h.prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status, "COMPLETED");
        for (const id of [flow.id, sms.id]) {
          const untouched = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id } });
          assert.equal(untouched.status, "PENDING"); assert.equal(untouched.attempts, 0); assert.equal(untouched.error, null);
        }
      });
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].from, "Macroalgae Farms <hello@macroalgaefarms.com>");
      assert.equal(bodies[0].reply_to, "help@macroalgaefarms.com");
      assert.deepEqual(bodies[0].to, [sharedAddress]);
      assert.doesNotMatch(String(bodies[0].html), /Corals Anonymous|coralsanonymous\.com/);
      assert.ok(shopifyCalls.length > 0);
      assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: coralsMessage.id } })).status, "PENDING");
      assert.equal((await h.prisma.marketingCampaign.findUniqueOrThrow({ where: { id: coralsCampaign.id } })).status, "SCHEDULED");
      await h.prisma.marketingMessage.update({ where: { id: coralsMessage.id }, data: { status: "CANCELLED" } });
      await h.prisma.marketingCampaign.update({ where: { id: coralsCampaign.id }, data: { status: "CANCELLED" } });
      assert.equal(currentMarketingBrand(), "corals-anonymous");
    } finally {
      globalThis.fetch = oldFetch;
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
}
