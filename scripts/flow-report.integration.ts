import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";

type Harness = Parameters<Parameters<typeof isolated>[2]>[0];
type MessageOptions = {
  key?: string;
  step?: number;
  stage?: string;
  sentAt?: Date | null;
  createdAt?: Date;
  status?: string;
  campaignId?: string;
};
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function customerReportTest(context: Context, name: string, work: (h: Harness) => Promise<void>) {
  await isolated(context, `flow-report-${name}`, async h => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error("Flow reports must not contact Shopify or an email provider."); };
    try {
      await h.prisma.marketingResource.upsert({
        where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
        create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Report test settings", data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } },
        update: { data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } },
      });
      await work(h);
      assert.equal(h.emails.length, 0, "reporting must never send an email");
    } finally { globalThis.fetch = savedFetch; }
  });
}

async function message(h: Harness, profileId: string, flowKey: "welcome" | "abandoned-cart", options: MessageOptions = {}) {
  const sentAt = options.sentAt === undefined ? ago(2) : options.sentAt;
  const step = options.step ?? 0;
  return h.prisma.marketingMessage.create({ data: {
    shop: h.shop,
    key: options.key || `${h.shop}:${flowKey}:${profileId}:${step}:${crypto.randomUUID()}`,
    profileId, flowKey: options.campaignId ? null : flowKey, campaignId: options.campaignId,
    flowStep: step,
    flowCondition: flowKey === "welcome" ? `welcome-v1:${step}` : `cart-v1:${options.stage || "first"}`,
    channel: "EMAIL", subject: `${flowKey} email ${step + 1}`, content: defaultContent,
    status: options.status || (sentAt ? "SENT" : "PENDING"),
    dueAt: sentAt || new Date(), sentAt, createdAt: options.createdAt || ago(3),
    triggerAt: options.createdAt || (sentAt ? new Date(+sentAt - 1000) : ago(3)),
  } });
}

async function event(h: Harness, profileId: string, messageId: string, type: string, occurredAt: Date, key?: string) {
  return h.store.atomic(tx => h.store.record(tx, {
    key: key || `${h.shop}:${type}:${crypto.randomUUID()}`, type, profileId, messageId, occurredAt,
  }));
}

async function order(h: Harness, profileId: string, orderId: string, occurredAt: Date, extra: Record<string, unknown> = {}, key?: string) {
  return h.store.atomic(tx => h.store.record(tx, {
    key: key || `order:${orderId}`, type: "ORDER", profileId, occurredAt,
    payload: { orderId, orderLabel: `#${orderId}`, revenue: "100", currency: "USD", ...extra },
  }));
}

export function registerFlowReportTests(context: () => Context) {
  test("flow reports: Welcome counts unique engagement, recipients and buyers with per-email sales and separate currencies", async () => customerReportTest(context(), "welcome-metrics", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const first = await h.make("welcome-metrics-first@example.com"), second = await h.make("welcome-metrics-second@example.com");
    const a = await message(h, first.id, "welcome", { step: 0, sentAt: ago(4), createdAt: ago(40) });
    const b = await message(h, first.id, "welcome", { step: 1, sentAt: ago(3) });
    const c = await message(h, second.id, "welcome", { step: 0, sentAt: ago(2) });
    for (const m of [a, b, c]) for (let repeat = 0; repeat < 2; repeat++)
      await event(h, m.profileId, m.id, "DELIVERED", new Date(+m.sentAt! + 1000));
    for (const type of ["OPENED", "CLICKED", "BOUNCED", "COMPLAINED", "UNSUBSCRIBED"])
      for (let repeat = 0; repeat < 2; repeat++) await event(h, first.id, a.id, type, ago(3.5));
    await event(h, first.id, b.id, "OPENED", ago(2.5));
    for (const status of ["PENDING", "SENDING", "CANCELLED", "FAILED", "UNKNOWN"])
      await message(h, second.id, "welcome", { step: 2, sentAt: null, createdAt: ago(1), status });
    await order(h, first.id, "1001", ago(1), { revenue: "42.50" });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_COUPON", key: first.id,
      name: "Assigned Welcome offer", data: { code: "WELCOME-METRICS" } } });
    await order(h, first.id, "1002", ago(0.5), { currency: "EUR", revenue: "12", discountCodes: ["WELCOME-METRICS"] });
    await order(h, second.id, "1003", ago(0.25));
    const report = await flowReport("welcome");
    assert.equal(report.flowKey, "welcome"); assert.equal(report.days, 30);
    assert.equal(report.totals.sent, 3); assert.equal(report.totals.recipients, 2);
    assert.equal(report.totals.delivered, 3); assert.equal(report.totals.opened, 2); assert.equal(report.totals.clicked, 1);
    assert.equal(report.totals.bounced, 1); assert.equal(report.totals.complained, 1); assert.equal(report.totals.unsubscribed, 1);
    assert.equal(report.totals.waiting, 2); assert.equal(report.totals.stopped, 1); assert.equal(report.totals.needsAttention, 2);
    assert.equal(report.totals.orders, 2); assert.equal(report.totals.convertedRecipients, 1);
    assert.deepEqual(report.totals.revenue, { USD: 42.5, EUR: 12 });
    assert.equal(report.steps.reduce((n, step) => n + step.sent, 0), report.totals.sent);
    const winningStep = report.steps.find(step => step.orders === 2);
    assert.ok(winningStep); assert.equal(winningStep.sent, 1); assert.equal(winningStep.convertedRecipients, 1);
    assert.deepEqual(winningStep.revenue, report.totals.revenue);
    assert.ok(report.orders.every(item => item.profileId === first.id && item.email === first.email && item.subject === b.subject));
    assert.deepEqual(report.orders.map(item => item.label), ["#1002", "#1001"]);
    assert.equal(report.orders[0].shopifyUrl, `https://${h.shop}/admin/orders/1002`);
    assert.ok(report.orders.every(item => ["OPENED", "COUPON"].includes(item.interaction) && item.step === winningStep.label));
    const analytics = await marketingAnalytics(), analyticsRow = analytics.rows.find(row => row.key === "welcome")!;
    assert.equal(analyticsRow.recipients, 2); assert.equal(analyticsRow.convertedRecipients, 1);
    assert.equal(analytics.totals.recipients, 2); assert.equal(analytics.totals.convertedRecipients, 1);
    assert.deepEqual(analyticsRow.revenue, report.totals.revenue);
  }));

  test("flow reports: a sale has one winner across Welcome, Cart and campaigns, including late engagement", async () => customerReportTest(context(), "last-touch", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const p = await h.make("flow-last-touch@example.com");
    const welcome = await message(h, p.id, "welcome", { sentAt: ago(4) });
    const cart = await message(h, p.id, "abandoned-cart", { sentAt: ago(3) });
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Last-touch campaign", subject: "Campaign", content: defaultContent, audience: {}, status: "COMPLETED" } });
    const campaignMessage = await message(h, p.id, "welcome", { campaignId: campaign.id, sentAt: ago(2) });
    await event(h, p.id, welcome.id, "OPENED", ago(3.5));
    await event(h, p.id, cart.id, "OPENED", ago(2.5));
    await event(h, p.id, campaignMessage.id, "OPENED", ago(1.5));
    await order(h, p.id, "2001", ago(1));
    assert.equal((await flowReport("welcome")).totals.orders, 0);
    assert.equal((await flowReport("abandoned-cart")).totals.orders, 0);
    assert.equal((await campaignReport(campaign.id)).totals.ordered, 1);
    await event(h, p.id, welcome.id, "OPENED", ago(1.25), "late-prepurchase-welcome-open");
    const welcomeReport = await flowReport("welcome"), cartReport = await flowReport("abandoned-cart"), analytics = await marketingAnalytics();
    assert.equal(welcomeReport.totals.orders, 1); assert.equal(cartReport.totals.orders, 0);
    assert.equal((await campaignReport(campaign.id)).totals.ordered, 0);
    assert.equal(analytics.totals.orders, 1);
    assert.deepEqual(analytics.rows.find(row => row.key === "welcome")!.revenue, welcomeReport.totals.revenue);
    assert.equal(analytics.rows.find(row => row.key === "abandoned-cart")!.orders, cartReport.totals.orders);
  }));

  test("flow reports: durable Welcome and Cart tests remain excluded and cannot steal real campaign sales", async () => customerReportTest(context(), "test-exclusion", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { findEmailAttribution } = await import("../lib/marketing/attribution");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const p = await h.make("flow-tests-excluded@example.com");
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Customer campaign", subject: "Campaign", content: defaultContent, audience: {}, status: "COMPLETED" } });
    const real = await message(h, p.id, "welcome", { campaignId: campaign.id, sentAt: ago(4) });
    const welcome = await message(h, p.id, "welcome", { key: `welcome-v1:${p.id}:0`, sentAt: ago(3) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_RUN", key: p.id, name: "Restricted Welcome test", data: { profileId: p.id, testEmail: p.email } } });
    const root = cartCheckoutKey(p.id, "test-checkout");
    const cart = await message(h, p.id, "abandoned-cart", { key: `${root}:first`, sentAt: ago(2) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_RUN", key: root, name: "Restricted Cart test", data: { profileId: p.id, testEmail: p.email } } });
    for (const [m, at] of [[real, ago(3.5)], [welcome, ago(2.5)], [cart, ago(1.5)]] as const) {
      await event(h, p.id, m.id, "DELIVERED", new Date(+m.sentAt! + 1000));
      await event(h, p.id, m.id, "OPENED", at);
    }
    await order(h, p.id, "3001", ago(1));
    for (const flow of ["welcome", "abandoned-cart"] as const) {
      const report = await flowReport(flow);
      assert.equal(report.totals.sent, 0); assert.equal(report.totals.opened, 0); assert.equal(report.totals.orders, 0);
      assert.equal(report.orders.length, 0);
    }
    assert.equal((await findEmailAttribution(h.prisma, p.id, ago(1)))?.messageId, real.id);
    const analytics = await marketingAnalytics();
    assert.equal(analytics.rows.find(row => row.key === "welcome")!.sent, 0);
    assert.equal(analytics.rows.find(row => row.key === campaign.id)!.orders, 1);
  }));

  test("flow reports: sent-date cohorts include delayed sends and exclude old sends and old waiting rows", async () => customerReportTest(context(), "cohort", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const p = await h.make("flow-cohort@example.com");
    await message(h, p.id, "welcome", { sentAt: ago(31), createdAt: ago(1) });
    const current = await message(h, p.id, "welcome", { sentAt: ago(2), createdAt: ago(40) });
    await message(h, p.id, "welcome", { sentAt: null, createdAt: ago(31) });
    await message(h, p.id, "welcome", { sentAt: null, createdAt: ago(1) });
    await event(h, p.id, current.id, "OPENED", ago(1.5));
    await order(h, p.id, "4001", ago(1));
    const report = await flowReport("welcome", 30);
    assert.equal(report.totals.sent, 1); assert.equal(report.totals.waiting, 1); assert.equal(report.totals.orders, 1);
    assert.equal((await flowReport("welcome", 90)).totals.sent, 2);
    assert.equal((await flowReport("welcome", 8)).days, 30, "unsupported periods use the default");
    assert.ok(Number.isFinite(Date.parse(report.since))); assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
  }));

  test("flow reports: Cart separates matching-checkout proof, other purchases, missing history and actual issued-code use", async () => customerReportTest(context(), "cart-evidence", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const p = await h.make("cart-proof@example.com"), root = cartCheckoutKey(p.id, "proof-checkout"), attempt = `${root}:attempt-12345`;
    const first = await message(h, p.id, "abandoned-cart", { key: `${attempt}:first`, sentAt: ago(4) });
    const final = await message(h, p.id, "abandoned-cart", { key: `${attempt}:final`, stage: "final-no", sentAt: ago(1), step: 1 });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_RUN", key: attempt, name: "Customer Cart run", data: { profileId: p.id } } });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_COUPON", key: final.id, name: "Cart coupon", data: { code: "AC300-PROOF" } } });
    await event(h, p.id, first.id, "OPENED", ago(3));
    await order(h, p.id, "5001", ago(2), { checkoutKey: root, discountCodes: ["AC300-PROOF"] });
    await order(h, p.id, "5002", ago(1.8), { checkoutKey: cartCheckoutKey(p.id, "other-checkout"), discountCodes: ["UNRELATED"] });
    await order(h, p.id, "5003", ago(1.6));
    await event(h, p.id, final.id, "OPENED", ago(0.75));
    await order(h, p.id, "5004", ago(0.5), { checkoutKey: root, discountCodes: ["ac300-proof", "UNRELATED"] });
    const report = await flowReport("abandoned-cart");
    assert.equal(report.totals.orders, 4); assert.equal(report.totals.convertedRecipients, 1);
    assert.equal(report.evidence.matchingCheckoutOrders, 2); assert.equal(report.evidence.missingCheckoutDetails, 1); assert.equal(report.evidence.discountOrders, 1);
    assert.equal(report.orders.find(item => item.label === "#5001")!.checkoutMatch, true);
    assert.deepEqual(report.orders.find(item => item.label === "#5001")!.discountCodes, [], "a coupon not emailed until after purchase is not email evidence");
    assert.equal(report.orders.find(item => item.label === "#5002")!.checkoutMatch, false);
    assert.equal(report.orders.find(item => item.label === "#5003")!.checkoutMatch, null);
    assert.equal(report.orders.find(item => item.label === "#5004")!.checkoutMatch, true);
    assert.deepEqual(report.orders.find(item => item.label === "#5004")!.discountCodes.map(code => code.toUpperCase()), ["AC300-PROOF"]);
  }));

  test("flow reports: Welcome shows its issued coupon only after a customer email has sent", async () => customerReportTest(context(), "welcome-coupon", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const p = await h.make("welcome-proof@example.com");
    const welcome = await message(h, p.id, "welcome", { key: `welcome-v1:${p.id}:0`, sentAt: ago(2) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_COUPON", key: p.id, name: "Welcome coupon", data: { code: "WELCOME10-PROOF" } } });
    await event(h, p.id, welcome.id, "OPENED", ago(1.5));
    await order(h, p.id, "6001", ago(1), { discountCodes: ["welcome10-proof", "OTHER"] });
    await order(h, p.id, "6002", ago(0.5), { discountCodes: ["OTHER"] });
    const report = await flowReport("welcome");
    assert.equal(report.totals.orders, 1); assert.equal(report.evidence.discountOrders, 1);
    assert.deepEqual(report.orders.find(item => item.label === "#6001")!.discountCodes.map(code => code.toUpperCase()), ["WELCOME10-PROOF"]);
    assert.equal(report.orders.some(item => item.label === "#6002"), false, "repeat purchases without the Welcome code are not Welcome sales");
    assert.ok(report.orders.every(item => item.checkoutMatch === null));
  }));

  test("flow reports: the Welcome social email alone is not proof that its unsent offer coupon was emailed", async () => customerReportTest(context(), "welcome-social-proof", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const p = await h.make("welcome-social-proof@example.com");
    await message(h, p.id, "welcome", { key: `welcome-v1:${p.id}:0`, step: 0, sentAt: null, status: "FAILED" });
    const social = await message(h, p.id, "welcome", { key: `welcome-v1:${p.id}:3`, step: 3, sentAt: ago(2) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_COUPON", key: p.id, name: "Prepared but unsent Welcome coupon", data: { code: "WELCOME10-UNSENT" } } });
    await event(h, p.id, social.id, "OPENED", ago(1.5));
    await order(h, p.id, "6101", ago(1), { discountCodes: ["WELCOME10-UNSENT"] });
    const report = await flowReport("welcome");
    assert.equal(report.totals.orders, 1, "the social email can still win standard email attribution");
    assert.equal(report.evidence.discountOrders, 0);
    assert.deepEqual(report.orders[0].discountCodes, []);
  }));

  test("flow reports: order ledgers paginate without duplicate order credit and replayed events stay idempotent", async () => customerReportTest(context(), "pagination", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const p = await h.make("flow-pages@example.com"), m = await message(h, p.id, "abandoned-cart", { sentAt: ago(2) });
    await event(h, p.id, m.id, "OPENED", ago(1.5));
    for (let i = 0; i < 27; i++) await order(h, p.id, String(7000 + i), new Date(+ago(1) + i * 1000), { revenue: "10" });
    await order(h, p.id, "7026", ago(0.5), { revenue: "10" }, "duplicate-source-order-7026");
    await order(h, p.id, "gid://shopify/Order/7026", ago(0.5), { revenue: "10" }, "duplicate-gid-source-order-7026");
    await order(h, p.id, "7000", ago(1), { revenue: "999" }, "order:7000");
    const first = await flowReport("abandoned-cart", 30, 1), second = await flowReport("abandoned-cart", 30, 2);
    assert.equal(first.totals.orders, 27); assert.equal(first.totals.convertedRecipients, 1); assert.deepEqual(first.totals.revenue, { USD: 270 });
    assert.deepEqual(first.ordersPage, { page: 1, pageSize: 25, total: 27, pages: 2 });
    assert.equal(first.orders.length, 25); assert.equal(second.orders.length, 2);
    assert.equal(new Set([...first.orders, ...second.orders].map(item => item.id)).size, 27);
    assert.ok(+new Date(first.orders[0].placedAt) > +new Date(second.orders[0].placedAt));
    assert.equal((await flowReport("abandoned-cart", 30, 999)).ordersPage.page, 2);
    assert.equal((await flowReport("abandoned-cart", 30, 0)).ordersPage.page, 1);
    assert.equal((await flowReport("abandoned-cart", 30, 1.5)).ordersPage.page, 1);
  }));

  test("flow reports: malformed or missing order amounts and currencies never fabricate revenue", async () => customerReportTest(context(), "unknown-money", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const p = await h.make("flow-unknown-money@example.com"), m = await message(h, p.id, "abandoned-cart", { sentAt: ago(2) });
    await event(h, p.id, m.id, "OPENED", ago(1.5));
    const payloads = [
      { revenue: "not money", currency: "USD" },
      { revenue: null, currency: "USD" },
      { revenue: "", currency: "USD" },
      { revenue: "10", currency: null },
    ];
    for (let i = 0; i < payloads.length; i++) await order(h, p.id, String(8000 + i), ago(1), payloads[i]);
    const report = await flowReport("abandoned-cart");
    assert.equal(report.totals.orders, 4); assert.equal(report.totals.convertedRecipients, 1);
    assert.deepEqual(report.totals.revenue, {});
    assert.ok(report.orders.filter(item => item.currency === "USD").every(item => item.amount === null));
    assert.ok(report.orders.every(item => item.checkoutMatch === null));
    const analytics = await marketingAnalytics();
    assert.deepEqual(analytics.rows.find(row => row.key === "abandoned-cart")!.revenue, report.totals.revenue);
    assert.deepEqual(analytics.totals.revenue, report.totals.revenue);
  }));

  test("flow reports: replayed Shopify orders retain one small checkout and coupon evidence summary", async () => customerReportTest(context(), "ingest-evidence", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const p = await h.make("flow-ingest-proof@example.com"), root = cartCheckoutKey(p.id, "ingest-proof-token");
    const m = await message(h, p.id, "abandoned-cart", { key: `${root}:final`, stage: "final-no", sentAt: ago(2) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_RUN", key: root, name: "Customer Cart run", data: { profileId: p.id } } });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_COUPON", key: m.id, name: "Cart coupon", data: { code: "AC300-INGEST" } } });
    await event(h, p.id, m.id, "OPENED", ago(1.5));
    const payload = {
      id: 9001, name: "#9001", email: p.email!, created_at: ago(1).toISOString(), total_price: "19.95", currency: "USD",
      checkout_token: "ingest-proof-token", discount_codes: [{ code: "AC300-INGEST" }, { code: "AC300-INGEST" }],
      line_items: [], note: "private raw order detail",
    };
    await h.ingest.ingestShopify("orders/create", "shopify-order-delivery-one", payload);
    await h.ingest.ingestShopify("orders/create", "shopify-order-delivery-two", payload);
    const summaries = await h.prisma.marketingEvent.findMany({ where: { shop: h.shop, type: "ORDER" } });
    assert.equal(summaries.length, 1);
    const compact = summaries[0].payload as { checkoutKey?: string; discountCodes?: string[] };
    assert.equal(compact.checkoutKey, root); assert.deepEqual(compact.discountCodes, ["AC300-INGEST"]);
    assert.equal(JSON.stringify(compact).includes("private raw order detail"), false);
    assert.equal(JSON.stringify(compact).includes("ingest-proof-token"), false, "compact evidence stores a hash, not the checkout token");
    const report = await flowReport("abandoned-cart");
    assert.equal(report.totals.orders, 1); assert.deepEqual(report.totals.revenue, { USD: 19.95 });
    assert.equal(report.evidence.matchingCheckoutOrders, 1); assert.equal(report.evidence.discountOrders, 1);
  }));

  test("flow reports: later Shopify updates fill missing evidence without rewriting original order value or time", async () => customerReportTest(context(), "enrich-evidence", async h => {
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const p = await h.make("flow-enrich-proof@example.com"), placedAt = ago(1);
    await h.ingest.ingestShopify("orders/create", "order-without-evidence", {
      id: 9002, email: p.email!, created_at: placedAt.toISOString(), total_price: "55", currency: "USD", line_items: [],
    });
    const original = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { shop_key: { shop: h.shop, key: "order:9002" } } });
    await h.ingest.ingestShopify("orders/updated", "order-evidence-arrived", {
      id: 9002, email: p.email!, created_at: ago(0.5).toISOString(), updated_at: new Date().toISOString(), total_price: "999", currency: "EUR",
      checkout_token: "enriched-checkout", discount_codes: [{ code: " ac300-enriched " }, { code: "AC300-ENRICHED" }], line_items: [],
    });
    await h.ingest.ingestShopify("orders/updated", "order-evidence-replayed", {
      id: 9002, email: p.email!, updated_at: new Date().toISOString(), checkout_token: "different-later-checkout", discount_codes: [{ code: "OTHER" }], line_items: [],
    });
    const enriched = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { id: original.id } });
    const compact = enriched.payload as { checkoutKey?: string; discountCodes?: string[]; revenue?: string; currency?: string };
    assert.equal(compact.checkoutKey, cartCheckoutKey(p.id, "enriched-checkout"));
    assert.deepEqual(compact.discountCodes, ["AC300-ENRICHED"]);
    assert.equal(compact.revenue, "55"); assert.equal(compact.currency, "USD");
    assert.equal(enriched.occurredAt.toISOString(), placedAt.toISOString());
    assert.equal(enriched.profileId, p.id);
    assert.equal(await h.prisma.marketingEvent.count({ where: { shop: h.shop, type: "ORDER" } }), 1);
  }));

  test("flow reports: legacy order evidence is derived read-only from retained Shopify events", async () => customerReportTest(context(), "legacy-evidence", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const p = await h.make("flow-legacy-proof@example.com"), root = cartCheckoutKey(p.id, "legacy-proof-token");
    const m = await message(h, p.id, "abandoned-cart", { key: `${root}:final`, stage: "final-no", sentAt: ago(2) });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_RUN", key: root, name: "Customer Cart run", data: { profileId: p.id } } });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_COUPON", key: m.id, name: "Cart coupon", data: { code: "AC300-LEGACY" } } });
    await event(h, p.id, m.id, "OPENED", ago(1.5));
    const summary = await order(h, p.id, "9003", ago(1));
    await h.store.atomic(tx => h.store.record(tx, {
      key: "retained-order-create-event", type: "orders/create", profileId: p.id, occurredAt: summary.occurredAt,
      payload: { id: 9003, name: "#9003", checkout_token: "legacy-proof-token", discount_codes: [{ code: "AC300-LEGACY" }], note: "retained private source detail" },
    }));
    await h.store.atomic(tx => h.store.record(tx, {
      key: "later-partial-order-update", type: "orders/updated", profileId: p.id, occurredAt: new Date(+summary.occurredAt + 1000),
      payload: { id: 9003, name: "#9003", discount_codes: [{ code: "AC300-LEGACY" }] },
    }));
    await h.store.atomic(tx => h.store.record(tx, {
      key: "latest-order-update-without-evidence", type: "orders/updated", profileId: p.id, occurredAt: new Date(+summary.occurredAt + 2000),
      payload: { id: 9003, name: "#9003", line_items: [] },
    }));
    const report = await flowReport("abandoned-cart");
    assert.equal(report.totals.orders, 1); assert.equal(report.evidence.matchingCheckoutOrders, 1);
    assert.equal(report.evidence.discountOrders, 1); assert.equal(report.evidence.missingCheckoutDetails, 0);
    assert.equal(report.orders[0].checkoutMatch, true); assert.deepEqual(report.orders[0].discountCodes, ["AC300-LEGACY"]);
    assert.equal(JSON.stringify(report).includes("retained private source detail"), false);
    assert.equal(JSON.stringify(report).includes("legacy-proof-token"), false);
    const afterRead = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { id: summary.id } });
    assert.deepEqual(afterRead.payload, summary.payload, "reporting must not backfill or expand saved order summaries");
    assert.equal(afterRead.messageId, summary.messageId);
  }));

  test("flow reports: repeat unsubscribe requests suppress once, retain Shopify sync and count one customer email", async () => customerReportTest(context(), "unsubscribe", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { POST } = await import("../app/api/marketing/unsubscribe/route");
    const p = await h.make("flow-unsubscribe@example.com"), sent = await message(h, p.id, "welcome", { sentAt: ago(1) });
    const pending = await message(h, p.id, "welcome", { step: 1, sentAt: null, createdAt: ago(0.5) });
    const request = () => new Request(`https://app.example/api/marketing/unsubscribe?token=${sent.token}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    });
    assert.equal((await POST(request())).status, 200);
    const recorded = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { shop_key: { shop: h.shop, key: `unsubscribe-link:${sent.id}` } } });
    assert.equal((await POST(request())).status, 200);
    const events = await h.prisma.marketingEvent.findMany({ where: { shop: h.shop, messageId: sent.id, type: "UNSUBSCRIBED" } });
    assert.equal(events.length, 1); assert.equal(events[0].profileId, p.id);
    assert.equal(events[0].occurredAt.toISOString(), recorded.occurredAt.toISOString(), "repeated requests retain the original unsubscribe time");
    const consent = await h.prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } } });
    assert.equal(consent.status, "UNSUBSCRIBED"); assert.equal(consent.suppressed, true); assert.equal(consent.source, "unsubscribe-link");
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: pending.id } })).status, "CANCELLED");
    const sync = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "SHOPIFY_EMAIL_UNSUBSCRIBE", key: p.id } } });
    assert.ok((sync.data as { attempts?: number }).attempts! >= 1, "temporary upstream failure leaves the durable opt-out synchronization queued");
    await event(h, p.id, sent.id, "UNSUBSCRIBED", new Date(), "provider-also-reported-unsubscribe");
    const report = await flowReport("welcome");
    assert.equal(report.totals.unsubscribed, 1); assert.equal(report.totals.sent, 1);
    assert.equal(report.totals.waiting, 0); assert.equal(report.totals.stopped, 1);
  }));
}
