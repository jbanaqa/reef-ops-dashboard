import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { PrismaClient } from "../app/generated/prisma/client";
import { cartDraft } from "../lib/marketing/cart-config";
import { validateFlow, type FlowConfig } from "../lib/marketing/flow-config";
import { defaultContent, DAY } from "../lib/marketing/rules";
import { paidOrderFixture } from "./paid-order.fixture";
let loadCart: typeof import("../lib/marketing/cart")["loadCart"],
  cartRunKey: typeof import("../lib/marketing/cart")["cartRunKey"],
  resolveCartContent: typeof import("../lib/marketing/cart-storage")["resolveCartContent"],
  clearPausedCartMessages: typeof import("../lib/marketing/cart-maintenance")["clearPausedCartMessages"],
  compactCartStorage: typeof import("../lib/marketing/cart-maintenance")["compactCartStorage"],
  cartReport: typeof import("../lib/marketing/cart-report")["cartReport"],
  marketingAnalytics: typeof import("../lib/marketing/analytics")["marketingAnalytics"];

export const cartAbandonmentFixture = (at: Date, id = "1", checkout = id) => ({
  id: "gid://shopify/Abandonment/" + id,
  checkoutId: "gid://shopify/AbandonedCheckout/" + BigInt("0x" + crypto.createHash("sha256").update(checkout).digest("hex").slice(0, 12)).toString(),
  abandonedAt: at.toISOString(),
});

/** Native checks remain explicit mocked Shopify requests, never live API traffic. */
export async function cartNativeFixtureResponse(prisma: PrismaClient, query: string, variables: Record<string, unknown>) {
  if (query.includes("CartAbandonmentCandidates") || query.includes("CartAbandonmentReadiness")) return Response.json({ data: {
    abandonedCheckouts: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  } });
  if (!query.includes("CartAbandonmentCheck")) return;
  const row = await prisma.marketingResource.findFirst({ where: { shop: process.env.SHOPIFY_SHOP_DOMAIN!, kind: "CART_RUN",
    data: { path: ["abandonment", "checkoutId"], equals: String(variables.id) },
  }, orderBy: { updatedAt: "desc" } });
  const run = row?.data as { profileId?: string; url?: string; abandonment?: { id: string; checkoutId: string; abandonedAt: string } } | undefined;
  const profile = run?.profileId ? await prisma.marketingProfile.findUnique({ where: { id: run.profileId } }) : null;
  return Response.json({ data: { abandonmentByAbandonedCheckoutId: run?.abandonment ? {
    id: run.abandonment.id, createdAt: run.abandonment.abandonedAt, abandonmentType: "CHECKOUT", customerHasNoOrderSinceAbandonment: true,
    abandonedCheckoutPayload: { id: run.abandonment.checkoutId, createdAt: run.abandonment.abandonedAt, completedAt: null, recoveredAt: null,
      abandonedCheckoutUrl: run.url, customer: { id: "gid://shopify/Customer/1", defaultEmailAddress: { emailAddress: profile?.email } } },
  } : null } });
}

/** Lifecycle fixtures explicitly represent Shopify's confirmed abandonment, not a raw update. */
export async function enrollCartFixture(...args: Parameters<typeof import("../lib/marketing/cart")["enrollCart"]>) {
  const { enrollCart } = await import("../lib/marketing/cart");
  const [tx, profileId, checkout, at, config, url, lines, observedAt, merchandise, abandonment] = args;
  return enrollCart(tx, profileId, checkout, at, config, url, lines, observedAt,
    merchandise ?? { currency: "USD", subtotalCents: 15000, merchandiseLines: 1 },
    abandonment ?? cartAbandonmentFixture(at, "1", profileId + ":" + checkout));
}
const enrollCart = enrollCartFixture;

export type Context = {
  prisma: PrismaClient;
  store: typeof import("../lib/marketing/store");
  ingest: typeof import("../lib/marketing/ingest");
  worker: typeof import("../lib/marketing/worker");
};
type Harness = Context & {
  shop: string; f: FlowConfig; flowId: string; orders: Map<string, string>; emails: Record<string, unknown>[];
  make: (email: string, sms?: boolean) => Promise<{ id: string; email: string | null }>;
};
export async function isolated(context: Context, name: string, work: (h: Harness) => Promise<void>) {
  ({ loadCart, cartRunKey } = await import("../lib/marketing/cart"));
  ({ resolveCartContent } = await import("../lib/marketing/cart-storage"));
  ({ clearPausedCartMessages, compactCartStorage } = await import("../lib/marketing/cart-maintenance"));
  ({ cartReport } = await import("../lib/marketing/cart-report"));
  ({ marketingAnalytics } = await import("../lib/marketing/analytics"));
  const oldShop = process.env.SHOPIFY_SHOP_DOMAIN, oldFetch = globalThis.fetch;
  const smsKeys = ["MARKETING_SMS_GATEWAY_URL", "MARKETING_SMS_GATEWAY_KEY", "MARKETING_SMS_WEBHOOK_SECRET"];
  const oldSms = smsKeys.map(k => process.env[k]);
  const shop = `cart-${name}.myshopify.com`, orders = new Map<string, string>(), emails: Record<string, unknown>[] = [];
  process.env.SHOPIFY_SHOP_DOMAIN = shop;
  smsKeys.forEach(k => delete process.env[k]);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) return Response.json({ access_token: "mock" });
    if (url.includes("/graphql.json")) {
      const b = JSON.parse(String(init?.body));
      const native = await cartNativeFixtureResponse(context.prisma, b.query, b.variables || {});
      if (native) return native;
      if (b.query.includes("CartAvailability")) return Response.json({ data: { nodes: b.variables.ids.map(() => ({
        status: "ACTIVE", onlineStoreUrl: "https://store.example/products/coral", title: "Coral", variants: { nodes: [{ availableForSale: true }] },
        availableForSale: true, product: { status: "ACTIVE", onlineStoreUrl: "https://store.example/products/coral", title: "Coral" },
      })) } });
      if (b.query.includes("CartOrderCheck")) {
        const email = String(b.variables.query).match(/email:"([^"]+)"/)?.[1] || "";
        return Response.json({ data: { orders: { nodes: orders.has(email) ? [{ createdAt: orders.get(email) }] : [] } } });
      }
    }
    if (url === "https://api.resend.com/emails") {
      emails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: `${name}-delivery-${emails.length}` });
    }
    throw Error("Unexpected request blocked in cart test: " + url);
  };
  try {
    await context.store.seed();
    const row = await context.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop, kind: "FLOW", key: "abandoned-cart" } } });
    const f = validateFlow("abandoned-cart", cartDraft(row.data as unknown as FlowConfig));
    f.reviewed = true; f.steps[0].minutes = 0; f.cart!.productCount = 0; f.cart!.sendStartHour = 0; f.cart!.sendEndHour = 24;
    await context.prisma.marketingResource.update({ where: { id: row.id }, data: { enabled: true, data: context.store.json(f) } });
    const make: Harness["make"] = async (email, sms) => {
      const p = await context.store.atomic(tx => context.store.identify(tx, { email, ...(sms ? { phone: "+16575550123" } : {}) }));
      await context.store.atomic(tx => context.store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date()));
      if (sms) await context.store.atomic(tx => context.store.consent(tx, p.id, "SMS_MARKETING", "SUBSCRIBED", "test", new Date()));
      return p;
    };
    await work({ ...context, shop, f, flowId: row.id, make, orders, emails });
  } finally {
    process.env.SHOPIFY_SHOP_DOMAIN = oldShop;
    globalThis.fetch = oldFetch;
    smsKeys.forEach((k, i) => { if (oldSms[i] === undefined) delete process.env[k]; else process.env[k] = oldSms[i]; });
  }
}

export function registerCartLaunchTests(context: () => Context) {
  test("cart launch: historical restricted tests stay out of customer totals and cannot take campaign revenue", async () => isolated(context(), "test-report", async h => {
    const p = await h.make("cart-test-report@example.com");
    h.f.cart!.testEmail = p.email!;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    await h.store.atomic(tx => enrollCart(tx, p.id, "report-test", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/test", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: "cart-v1:first" } });
    await h.worker.runMarketing(first.id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "SENT");
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Real campaign", subject: "Campaign", content: defaultContent, audience: {}, status: "SENT" } });
    const real = await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "real-report-campaign", profileId: p.id, campaignId: campaign.id, channel: "EMAIL", subject: "Campaign", content: defaultContent, status: "SENT", sentAt: new Date(Date.now() - 10000), dueAt: new Date() } });
    await h.store.atomic(tx => h.store.record(tx, { key: "real-open", type: "OPENED", profileId: p.id, messageId: real.id, occurredAt: new Date(Date.now() - 1000) }));
    await h.store.atomic(tx => h.store.record(tx, { key: "test-open", type: "OPENED", profileId: p.id, messageId: first.id }));
    await h.store.atomic(tx => h.store.record(tx, { key: "test-order", type: "ORDER", profileId: p.id, payload: paidOrderFixture({ revenue: "100", currency: "USD" }) }));
    delete h.f.cart!.testEmail;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    const report = await cartReport();
    assert.equal(report.rows.reduce((n,r) => n + r.sent + r.opened + r.orders, 0), 0);
    assert.equal(report.activity.length, 0);
    const analytics = await marketingAnalytics();
    assert.equal(analytics.rows.find(r => r.key === "abandoned-cart")!.sent, 0);
    assert.equal(analytics.rows.find(r => r.key === campaign.id)!.revenue.USD, 100);
  }));
  test("cart launch: creation time survives updates, completed checkouts and reordered events cannot send", async () => isolated(context(), "checkout", async h => {
    const p = await h.make("cart-time@example.com");
    const start = new Date(Date.now() - 3600000), update = new Date(Date.now() - 60000);
    const checkout = { token: "time", email: p.email!, created_at: start.toISOString(), updated_at: update.toISOString(),
      currency: "USD", subtotal_price: "150.00", abandoned_checkout_url: "https://store.example/checkouts/time",
      line_items: [{ product_id: 1, title: "Coral", quantity: 1, price: "150.00", discount_allocations: [] }] };
    await h.ingest.ingestShopify("checkouts/update", "time-1", checkout);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
    await h.store.atomic(tx => enrollCart(tx, p.id, "time", start, h.f, checkout.abandoned_checkout_url, [{ product_id: 1 }], update));
    let messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: p.id } });
    assert.equal(messages.length, 2);
    assert.ok(messages.every(m => +m.triggerAt! === +start));
    await h.ingest.ingestShopify("checkouts/update", "time-2", { ...checkout, updated_at: new Date().toISOString() });
    messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: p.id } });
    assert.ok(messages.every(m => +m.triggerAt! === +start), "updates never shift the purchase-check boundary");
    const orderAt = new Date(+start + 10000);
    h.orders.set(p.email!, orderAt.toISOString());
    await h.worker.runMarketing(messages.find(m => m.flowCondition === "cart-v1:first")!.id);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    assert.equal(h.emails.length, 0);

    const backlog = await h.make("updated-backlog@example.com");
    const originalStart = new Date(Date.now() - 4 * DAY);
    await h.store.atomic(tx => enrollCart(tx, backlog.id, "backlog", originalStart, h.f, "https://store.example/checkouts/backlog", [{ product_id: 1 }], new Date()));
    h.orders.set(backlog.email!, new Date(Date.now() - DAY).toISOString());
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: backlog.id } }), 0,
      "a recent metadata update cannot revive an expired native abandonment");

    const completed = await h.make("completed-cart@example.com");
    await h.ingest.ingestShopify("checkouts/update", "complete-first", { ...checkout, token: "completed", email: completed.email!, completed_at: update.toISOString() });
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: completed.id } }), 0);
    await h.ingest.ingestShopify("checkouts/create", "older-after-complete", { ...checkout, token: "completed", email: completed.email! });
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: completed.id } }), 0, "an older incomplete webhook cannot revive a completed token");

    const pending = await h.make("pending-complete@example.com");
    await h.ingest.ingestShopify("checkouts/create", "pending-start", { ...checkout, token: "pending", email: pending.email! });
    await h.ingest.ingestShopify("checkouts/update", "pending-complete", { ...checkout, token: "pending", email: pending.email!, completed_at: update.toISOString() });
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: pending.id, status: "PENDING" } }), 0);
  }));

  test("cart launch: SMS unavailable uses email and stale queued attempts expire as a whole", async () => isolated(context(), "gates", async h => {
    const p = await h.make("sms-fallback@example.com", true);
    await h.store.atomic(tx => enrollCart(tx, p.id, "sms-off", new Date(Date.now() - 3600000), h.f, "https://store.example/checkouts/sms", [{ product_id: 1 }]));
    let messages = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id } });
    assert.equal(messages.length, 2, "unconfigured SMS adds neither a text nor its delay");
    await h.worker.runMarketing(messages.find(m => m.flowCondition === "cart-v1:first")!.id);
    assert.equal(h.emails.length, 1);

    const smsPending = await h.make("old-sms-path@example.com");
    await h.prisma.marketingProfile.update({ where: { id: smsPending.id }, data: { phone: "+16575550124" } });
    await h.store.atomic(tx => h.store.consent(tx, smsPending.id, "SMS_MARKETING", "SUBSCRIBED", "test", new Date()));
    Object.assign(process.env, { MARKETING_SMS_GATEWAY_URL: "https://sms.example", MARKETING_SMS_GATEWAY_KEY: "test", MARKETING_SMS_WEBHOOK_SECRET: "test" });
    await h.store.atomic(tx => enrollCart(tx, smsPending.id, "sms-was-on", new Date(Date.now() - 3600000), h.f, "https://store.example/checkouts/sms-old", [{ product_id: 1 }]));
    delete process.env.MARKETING_SMS_GATEWAY_URL; delete process.env.MARKETING_SMS_GATEWAY_KEY; delete process.env.MARKETING_SMS_WEBHOOK_SECRET;
    await h.worker.runMarketing();
    await h.worker.runMarketing();
    assert.equal((await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: smsPending.id, channel: "SMS_MARKETING" } })).error, "SMS unavailable; continuing by email");
    assert.equal(h.emails.length, 2, "an existing unconfigured SMS branch also lets its emails continue");
    const old = await h.make("expired-cart@example.com");
    await h.store.atomic(tx => enrollCart(tx, old.id, "old", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/old", [{ product_id: 1 }]));
    messages = await h.prisma.marketingMessage.findMany({ where: { profileId: old.id } });
    const expiredRun = await h.prisma.marketingResource.findUniqueOrThrow({ where: {
      shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(messages[0].key) },
    } });
    const expiredData = expiredRun.data as { abandonment: { id: string; checkoutId: string; abandonedAt: string } };
    await h.prisma.marketingResource.update({ where: { id: expiredRun.id }, data: { data: h.store.json({
      ...expiredRun.data as object, abandonment: { ...expiredData.abandonment, abandonedAt: new Date(Date.now() - 10 * DAY).toISOString() },
    }) } });
    await h.worker.runMarketing(messages.find(m => m.flowCondition === "cart-v1:first")!.id);
    const expired = await h.prisma.marketingMessage.findMany({ where: { profileId: old.id } });
    assert.ok(expired.every(m => m.status === "CANCELLED" && m.error === "Checkout expired"));
    assert.equal(h.emails.length, 2);
  }));

  test("cart launch: shared artwork/configuration stay compact, resolve safely and compact legacy rows losslessly", async () => isolated(context(), "storage", async h => {
    const image = "data:image/png;base64," + "A".repeat(40000);
    h.f.steps[0].content.logo = image;
    h.f.orderBranch!.yes.content.logo = image;
    h.f.orderBranch!.no.content.logo = image;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    for (let i = 0; i < 3; i++) {
      const p = await h.make(`compact${i}@example.com`);
      await h.store.atomic(tx => enrollCart(tx, p.id, `checkout${i}`, new Date(Date.now() - 60000), h.f, `https://store.example/checkouts/${i}`, [{ product_id: 1 }]));
    }
    const runs = await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "CART_RUN" } });
    const messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop } });
    assert.ok(runs.every(r => JSON.stringify(r.data).length < 1000 && !(r.data as { config?: unknown }).config));
    assert.ok(messages.every(m => JSON.stringify(m.content).length < 1000));
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_ASSET" } }), 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_CONFIG" } }), 1);
    const first = messages.find(m => m.flowCondition === "cart-v1:first")!;
    assert.equal((await loadCart(first.key)).config.steps[0].content.logo, image);
    const decoded = await resolveCartContent(h.prisma, h.shop, first.content);
    assert.equal(decoded.logo, image);
    await assert.rejects(resolveCartContent(h.prisma, "wrong.myshopify.com", first.content), /missing or damaged/);
    await h.worker.runMarketing(first.id);
    const sent = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(sent.status, "SENT");
    assert.ok(JSON.stringify(sent.content).length < 1000, "preparation must not expand the stored message");
    assert.equal((h.emails[0].attachments as { content: string }[])[0].content, image.split(",")[1]);

    // Simulate legacy inline data, then compact while only this flow is paused.
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { enabled: false } });
    const original = await loadCart(first.key);
    const run = runs.find(r => r.key === cartRunKey(first.key))!;
    await h.prisma.marketingResource.update({ where: { id: run.id }, data: { data: h.store.json(original) } });
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { content: h.store.json(decoded) } });
    await h.prisma.marketingResource.updateMany({ where: { shop: h.shop, kind: "CART_READY", key: first.id }, data: { data: h.store.json(decoded) } });
    const compacted = await compactCartStorage();
    assert.equal(compacted.runs, 1); assert.equal(compacted.messages, 1); assert.equal(compacted.prepared, 1);
    assert.deepEqual(await resolveCartContent(h.prisma, h.shop, (await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).content), decoded);
    assert.equal((await loadCart(first.key)).config.steps[0].content.logo, image);
    assert.deepEqual(await compactCartStorage(), { runs: 0, messages: 0, prepared: 0 });
    const asset = await h.prisma.marketingResource.findFirstOrThrow({ where: { shop: h.shop, kind: "CART_ASSET" } });
    await h.prisma.marketingResource.update({ where: { id: asset.id }, data: { data: { value: "damaged" } } });
    await assert.rejects(resolveCartContent(h.prisma, h.shop, sent.content), /missing or damaged/);
  }));

  test("cart launch: cleanup removes only old pending cart messages and refuses an active flow", async () => isolated(context(), "cleanup", async h => {
    const p = await h.make("cleanup@example.com");
    await h.store.atomic(tx => enrollCart(tx, p.id, "cleanup", new Date(Date.now() - DAY), h.f, "https://store.example/checkouts/cleanup", [{ product_id: 1 }]));
    const cutoff = new Date(Date.now() - 1000);
    await h.prisma.marketingMessage.updateMany({ where: { shop: h.shop }, data: { createdAt: new Date(Date.now() - DAY) } });
    await assert.rejects(clearPausedCartMessages(cutoff), /Pause Abandoned Cart/);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { enabled: false } });
    await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "retain-welcome", profileId: p.id, flowKey: "welcome", status: "PENDING", channel: "EMAIL", subject: "Keep", content: defaultContent, dueAt: new Date(), createdAt: new Date(Date.now() - DAY) } });
    await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "retain-sent", profileId: p.id, flowKey: "abandoned-cart", status: "SENT", channel: "EMAIL", subject: "Keep sent", content: defaultContent, sentAt: new Date(), dueAt: new Date(), createdAt: new Date(Date.now() - DAY) } });
    assert.deepEqual(await clearPausedCartMessages(cutoff), { deleted: 2 });
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.shop } }), 2);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_RUN" } }), 0);
    assert.deepEqual(await clearPausedCartMessages(cutoff), { deleted: 0 });
  }));

  test("cart launch: late engagement and attribution changes match Analytics; bounces and complaints count once", async () => isolated(context(), "report", async h => {
    const p = await h.make("late-cart@example.com");
    const m = await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "late-cart", profileId: p.id, flowKey: "abandoned-cart", flowCondition: "cart-v1:first", channel: "EMAIL", subject: "Cart", content: defaultContent, status: "SENT", sentAt: new Date(Date.now() - 4 * DAY), dueAt: new Date(), createdAt: new Date(Date.now() - 40 * DAY) } });
    await h.store.atomic(tx => h.store.record(tx, { key: "late-order", type: "ORDER", profileId: p.id, occurredAt: new Date(Date.now() - DAY), payload: paidOrderFixture({ orderId: "123", orderLabel: "#123", revenue: "100", currency: "USD" }) }));
    assert.equal((await cartReport()).rows.find(r => r.key === "first")!.orders, 0);
    await h.store.atomic(tx => h.store.record(tx, { key: "late-open", type: "OPENED", profileId: p.id, messageId: m.id, occurredAt: new Date(Date.now() - 2 * DAY) }));
    for (const type of ["BOUNCED", "COMPLAINED"]) for (let i = 0; i < 2; i++) await h.store.atomic(tx => h.store.record(tx, { key: type + i, type, profileId: p.id, messageId: m.id }));
    const report = await cartReport(), row = report.rows.find(r => r.key === "first")!;
    assert.equal(row.orders, 1); assert.equal(row.revenue.USD, 100); assert.equal(row.bounced, 1); assert.equal(row.complained, 1);
    assert.equal(report.orders[0].label, "#123"); assert.equal(report.orders[0].email, p.email);
    assert.equal((await marketingAnalytics()).rows.find(r => r.key === "abandoned-cart")!.revenue.USD, row.revenue.USD);
    await h.prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
      create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Settings", data: { attribution: { emailClickDays: 1, emailOpenDays: 1 } } },
      update: { data: { attribution: { emailClickDays: 1, emailOpenDays: 1 } } } });
    assert.equal((await cartReport()).rows.find(r => r.key === "first")!.orders, 0);
    assert.equal((await marketingAnalytics()).rows.find(r => r.key === "abandoned-cart")!.orders, 0);
  }));
}
