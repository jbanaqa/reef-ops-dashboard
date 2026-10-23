import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Context } from "./cart-launch.integration";
import { runWithMarketingBrand } from "../lib/marketing/context";
import { defaultMacroCampaignContent } from "../lib/marketing/brands";

async function isolated(context: Context, work: (macroShop: string) => Promise<void>) {
  const keys = ["SPECIES_LIBRARY_SHOP_DOMAIN", "DASHBOARD_AUTH_DISABLED", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "MACROALGAE_RESEND_WEBHOOK_SECRET"];
  const old = keys.map(key => process.env[key]);
  const macroShop = "macroalgaefarms-routes-" + crypto.randomUUID() + ".myshopify.com";
  Object.assign(process.env, { SPECIES_LIBRARY_SHOP_DOMAIN: macroShop, DASHBOARD_AUTH_DISABLED: "true", RESEND_API_KEY: "re_fixture", RESEND_WEBHOOK_SECRET: "whsec_" + Buffer.from("fixture-signing-secret").toString("base64") });
  delete process.env.MACROALGAE_RESEND_WEBHOOK_SECRET;
  try { await work(macroShop); }
  finally { keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }); }
}
const request = (brand: string, body: unknown) => new Request("https://dashboard.example/api/marketing?brand=" + brand, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function registerMarketingBrandRouteTests(context: () => Context) {
  test("Brand routes: concurrent reads isolate profiles, settings and new-store resources", async () => isolated(context(), async macroShop => {
    const { prisma, store } = context();
    const address = "same-" + crypto.randomUUID() + "@example.com";
    const corals = await store.atomic(tx => store.identify(tx, { email: address }));
    const macro = await runWithMarketingBrand("macroalgae-farms", () => store.atomic(tx => store.identify(tx, { email: address })));
    assert.notEqual(corals.id, macro.id);
    assert.equal(macro.shop, macroShop);
    const api = await import("../app/api/marketing/route");
    const [a, b] = await Promise.all([api.GET(new Request("https://dashboard.example/api/marketing?brand=corals-anonymous&q=" + address)), api.GET(new Request("https://dashboard.example/api/marketing?brand=macroalgae-farms&q=" + address))]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const ca = await a.json(), ma = await b.json();
    assert.equal(ca.brand.id, "corals-anonymous"); assert.equal(ma.brand.id, "macroalgae-farms");
    assert.deepEqual(ca.profiles.map((p: { id: string }) => p.id), [corals.id]);
    assert.deepEqual(ma.profiles.map((p: { id: string }) => p.id), [macro.id]);
    assert.equal(ma.settings.organizationName, "Macroalgae Farms"); assert.equal(ma.settings.postalAddress, "");
    assert.equal(ma.settings.operations.sendingEnabled, false); assert.equal(ma.setup.sendingEnabled, false);
    assert.equal(ma.resources.some((r: { kind: string }) => r.kind === "FLOW"), false);
    assert.equal(ma.resources.some((r: { name: string }) => r.name.includes("Corals Anonymous")), false);
    assert.equal(await prisma.marketingMessage.count({ where: { shop: macroShop } }), 0);
    const preview = await api.GET(new Request("https://dashboard.example/api/marketing?brand=macroalgae-farms&view=preview"));
    const html = await preview.text();
    assert.match(html, /Macroalgae Farms/); assert.doesNotMatch(html, /coralsanonymous\.com|Corals Anonymous/);
    assert.equal((await api.GET(new Request("https://dashboard.example/api/marketing?brand=typo"))).status, 400);
  }));

  test("Brand routes: another store's campaign and profile IDs cannot be mutated", async () => isolated(context(), async () => {
    const { prisma, store } = context();
    const profile = await store.atomic(async tx => { const p = await store.identify(tx, { email: crypto.randomUUID() + "@example.com" }); await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date()); return p; });
    const campaign = await prisma.marketingCampaign.create({ data: { shop: profile.shop, name: "Corals protected draft", subject: "Protected", content: store.json(defaultMacroCampaignContent), audience: {} } });
    const api = await import("../app/api/marketing/route");
    for (const body of [
      { action: "cancel", id: campaign.id },
      { action: "send-now", id: campaign.id },
      { action: "save-campaign", id: campaign.id, name: "Wrong store", subject: "Wrong", content: defaultMacroCampaignContent, audience: { version: 2, includeKeys: ["mailable"], excludeKeys: [] } },
      { action: "suppress", id: profile.id, channel: "EMAIL" },
      { action: "save-resource", kind: "FLOW", key: "welcome", enabled: true, name: "Wrong store", data: {} },
    ]) assert.equal((await api.POST(request("macroalgae-farms", body))).status, 400);
    assert.equal((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status, "DRAFT");
    assert.equal((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).name, "Corals protected draft");
    assert.equal((await prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: profile.id, channel: "EMAIL" } } })).suppressed, false);
  }));

  test("Brand routes: public unsubscribe identifies its store from the unique message token", async () => isolated(context(), async () => {
    const { prisma, store } = context();
    const address = crypto.randomUUID() + "@example.com";
    const create = () => store.atomic(async tx => { const p = await store.identify(tx, { email: address }); await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date()); return p; });
    const ca = await create(), ma = await runWithMarketingBrand("macroalgae-farms", create);
    const message = await prisma.marketingMessage.create({ data: { shop: ma.shop, key: "brand-unsubscribe:" + crypto.randomUUID(), profileId: ma.id, channel: "EMAIL", subject: "Macro", content: store.json(defaultMacroCampaignContent), dueAt: new Date() } });
    const route = await import("../app/api/marketing/unsubscribe/route");
    const url = "https://dashboard.example/api/marketing/unsubscribe?token=" + message.token;
    const page = await route.GET(new Request(url));
    assert.equal(page.status, 200); assert.match(await page.text(), /Macroalgae Farms/);
    assert.equal((await route.GET(new Request(url + "&brand=corals-anonymous"))).status, 404);
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error("Fixture Shopify offline"); };
    try { assert.equal((await route.POST(new Request(url, { method: "POST" }))).status, 200); } finally { globalThis.fetch = oldFetch; }
    const consent = (id: string) => prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: id, channel: "EMAIL" } } });
    assert.equal((await consent(ma.id)).suppressed, true); assert.equal((await consent(ca.id)).suppressed, false);
  }));

  test("Brand routes: shared Resend webhook records engagement only for the message's store", async () => isolated(context(), async () => {
    const { prisma, store } = context();
    const ma = await runWithMarketingBrand("macroalgae-farms", () => store.atomic(tx => store.identify(tx, { email: crypto.randomUUID() + "@example.com" })));
    const providerId = crypto.randomUUID();
    const message = await prisma.marketingMessage.create({ data: { shop: ma.shop, key: "brand-webhook:" + crypto.randomUUID(), profileId: ma.id, providerId, channel: "EMAIL", subject: "Macro", content: store.json(defaultMacroCampaignContent), dueAt: new Date(), sentAt: new Date(Date.now() - 10000), status: "SENT" } });
    const payload = JSON.stringify({ type: "email.opened", created_at: new Date().toISOString(), data: { email_id: providerId } });
    const id = "msg_" + crypto.randomUUID(), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", Buffer.from("fixture-signing-secret")).update(id + "." + timestamp + "." + payload).digest("base64");
    const route = await import("../app/api/marketing/webhooks/route");
    const response = await route.POST(new Request("https://dashboard.example/api/marketing/webhooks?source=resend", { method: "POST", headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": "v1," + signature }, body: payload }));
    assert.equal(response.status, 200);
    const events = await prisma.marketingEvent.findMany({ where: { messageId: message.id, type: "OPENED" } });
    assert.equal(events.length, 1); assert.equal(events[0].shop, ma.shop); assert.equal(events[0].profileId, ma.id);
  }));
}
