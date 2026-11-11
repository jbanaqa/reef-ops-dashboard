import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";
import { defaultWelcome, welcomeSteps } from "../lib/marketing/welcome-config";
import { validateFlow } from "../lib/marketing/flow-config";

export function registerCartIsolationTests(context: () => Context) {
  test("cart email isolation: a pending Welcome reminder ignores cart receipts and uncertain cart sends", async () => isolated(context(), "isolated-welcome", async h => {
    const { enrollWelcome } = await import("../lib/marketing/welcome");
    const p = await h.make("independent-welcome@example.com");
    const config = validateFlow("welcome", { reviewed: true, welcome: defaultWelcome, steps: welcomeSteps });
    await h.prisma.marketingResource.update({ where: { shop_kind_key: { shop: h.shop, kind: "FLOW", key: "welcome" } }, data: { enabled: true, data: h.store.json(config) } });
    await h.store.atomic(tx => enrollWelcome(tx, p.id, new Date(Date.now() - 4 * DAY), config));
    await h.prisma.marketingMessage.updateMany({ where: { profileId: p.id, flowKey: "welcome", flowStep: 0 }, data: { status: "SENT", sentAt: new Date(Date.now() - 2 * DAY) } });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_COUPON", key: p.id, name: "Existing Welcome offer", data: { code: "WELCOME-ISOLATION", discountId: "gid://shopify/DiscountCodeNode/isolation", startsAt: new Date(Date.now() - 2 * DAY).toISOString(), endsAt: new Date(Date.now() + 7 * DAY).toISOString() } } });
    await h.prisma.marketingMessage.createMany({ data: ["SENT", "UNKNOWN"].map(status => ({ shop: h.shop, profileId: p.id, key: "welcome-cart-" + crypto.randomUUID(), flowKey: "abandoned-cart", channel: "EMAIL", subject: "Cart", content: defaultContent, status, dueAt: new Date(), ...(status === "SENT" ? { sentAt: new Date() } : {}) })) });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => String(init?.body).includes("WelcomePurchaseCheck")
      ? Response.json({ data: { orders: { nodes: [] } } }) : previousFetch(input, init);
    const reminder = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowKey: "welcome", flowStep: 1 } });
    await h.worker.runMarketing(reminder.id);
    const result = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(result.status, "SENT", result.error || "Welcome keeps its own timing");
    assert.equal(h.emails.length, 1);
  }));
  test("cart email isolation: recent local/external email and unrelated uncertain sends do not delay recovery", async () => isolated(context(), "isolated-cart", async h => {
    const p = await h.make("independent-cart@example.com"), at = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "independent", at, h.f, "https://store.example/checkouts/independent", [{ product_id: 1 }]));
    await h.prisma.marketingMessage.createMany({ data: [
      { shop: h.shop, profileId: p.id, key: "recent-campaign-" + crypto.randomUUID(), channel: "EMAIL", subject: "Recent campaign", content: defaultContent, status: "SENT", sentAt: new Date(), dueAt: new Date() },
      { shop: h.shop, profileId: p.id, key: "unknown-other-" + crypto.randomUUID(), flowKey: "welcome", channel: "EMAIL", subject: "Other uncertain email", content: defaultContent, status: "UNKNOWN", dueAt: new Date() },
    ] });
    await h.store.atomic(tx => h.store.record(tx, { key: "external-" + crypto.randomUUID(), type: "EXTERNAL_EMAIL_SENT", profileId: p.id, payload: { email: p.email }, occurredAt: new Date() }));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await h.worker.runMarketing(first.id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "SENT");
    assert.equal(h.emails.length, 1);
  }));

  test("cart email isolation: sent and uncertain cart mail do not block campaigns, while normal Smart Sending remains", async () => isolated(context(), "isolated-campaign", async h => {
    const createCampaignMessage = async (profileId: string) => {
      const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Independent campaign", subject: "Independent campaign", content: defaultContent, audience: {}, status: "SENDING", smartSendingHours: 16 } });
      return h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "campaign-" + crypto.randomUUID(), campaignId: campaign.id, profileId, channel: "EMAIL", subject: "Independent campaign", content: defaultContent, dueAt: new Date() } });
    };
    const p = await h.make("independent-campaign@example.com");
    await h.prisma.marketingMessage.createMany({ data: ["SENT", "UNKNOWN"].map(status => ({ shop: h.shop, profileId: p.id, key: "cart-history-" + crypto.randomUUID(), flowKey: "abandoned-cart", channel: "EMAIL", subject: "Cart", content: defaultContent, status, dueAt: new Date(), ...(status === "SENT" ? { sentAt: new Date() } : {}) })) });
    const campaign = await createCampaignMessage(p.id);
    await h.worker.runMarketing();
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: campaign.id } })).status, "SENT", "Cart history and reservations are outside campaign spacing");
    const next = await createCampaignMessage(p.id);
    await h.worker.runMarketing();
    const blocked = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: next.id } });
    assert.equal(blocked.status, "CANCELLED");
    assert.match(blocked.error || "", /Smart Sending/);
    const other = await h.make("ordinary-reservation@example.com");
    await h.prisma.marketingMessage.create({ data: { shop: h.shop, profileId: other.id, key: "unknown-ordinary-" + crypto.randomUUID(), flowKey: "welcome", channel: "EMAIL", subject: "Other unknown", content: defaultContent, status: "UNKNOWN", dueAt: new Date() } });
    const held = await createCampaignMessage(other.id);
    await h.worker.runMarketing();
    assert.match((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: held.id } })).error || "", /delivery is being checked/);
  }));

  test("cart email isolation: uncertain cart delivery still holds its own recovery messages", async () => isolated(context(), "isolated-reservation", async h => {
    const p = await h.make("own-unknown-cart@example.com"), at = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "held", at, h.f, "https://store.example/checkouts/held", [{ product_id: 1 }]));
    await h.prisma.marketingMessage.create({ data: { shop: h.shop, profileId: p.id, key: "older-cart-unknown-" + crypto.randomUUID(), flowKey: "abandoned-cart", channel: "EMAIL", subject: "Uncertain cart", content: defaultContent, status: "UNKNOWN", dueAt: new Date() } });
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await h.worker.runMarketing(first.id);
    assert.match((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).error || "", /delivery is being checked/);
    assert.equal(h.emails.length, 0);
  }));
}
