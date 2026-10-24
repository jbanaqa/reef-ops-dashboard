import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";
import { mockOrderPaymentSource } from "./paid-order.fixture";

type Harness = Parameters<Parameters<typeof isolated>[2]>[0];
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function settings(h: Harness) {
  await h.prisma.marketingResource.upsert({
    where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
    create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Paid reporting", data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } },
    update: { data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } },
  });
}

async function campaign(h: Harness) {
  return h.prisma.marketingCampaign.create({ data: {
    shop: h.shop, name: "Paid revenue campaign", subject: "New coral", content: defaultContent, audience: {}, status: "COMPLETED",
  } });
}

async function sent(h: Harness, profileId: string, target: { campaignId: string } | { flowKey: string }, triggerAt = ago(5)) {
  const sentAt = ago(3);
  const m = await h.prisma.marketingMessage.create({ data: {
    shop: h.shop, key: `paid-message:${crypto.randomUUID()}`, profileId, ...target,
    flowStep: 0, flowCondition: "flowKey" in target && target.flowKey === "abandoned-cart" ? "cart-v1:first" : "welcome-v1:0",
    channel: "EMAIL", subject: "Paid conversion evidence", content: defaultContent, status: "SENT", sentAt, dueAt: sentAt, triggerAt,
  } });
  await h.store.atomic(tx => h.store.record(tx, {
    key: `paid-open:${m.id}`, type: "OPENED", profileId, messageId: m.id, occurredAt: ago(2),
  }));
  return m;
}

async function order(h: Harness, profileId: string, id: string, total: string, extra: Record<string, unknown> = {}, occurredAt = ago(1)) {
  return h.store.atomic(tx => h.store.record(tx, {
    key: `paid-order:${crypto.randomUUID()}`, type: "ORDER", profileId, occurredAt,
    payload: h.store.json({ orderId: id, orderLabel: "#" + id.replace(/^gid:\/\/shopify\/Order\//, ""),
      revenue: total, currency: "USD", ...extra }),
  }));
}

export function registerPaidRevenueTests(context: () => Context) {
  test("paid revenue: all campaign, flow and analytics ledgers use verified collected money, with one winner and exact currency totals", async () => isolated(context(), "paid-all-reports", async h => {
    await settings(h);
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartReport } = await import("../lib/marketing/cart-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const c = await campaign(h), a = await h.make("paid-campaign@example.com"), w = await h.make("paid-welcome@example.com"), cart = await h.make("paid-cart@example.com");
    await sent(h, a.id, { campaignId: c.id });
    await sent(h, w.id, { flowKey: "welcome" });
    await sent(h, cart.id, { flowKey: "abandoned-cart" });
    const raw = await order(h, a.id, "61001", "739.40");
    await order(h, a.id, "61002", "10.00");
    await order(h, a.id, "61003", "20.00");
    await order(h, a.id, "61004", "100.00", { currency: "EUR" });
    await order(h, w.id, "61005", "75.00");
    await order(h, cart.id, "61006", "39.00");
    for (const [id, flags] of [
      ["61007", {}], ["61008", { financialStatus: "authorized" }], ["61009", { financialStatus: "refunded" }],
      ["61010", { cancelledAt: ago(0.5).toISOString() }], ["61011", { test: true }], ["61012", { financialStatus: "refunded" }],
    ] as const) await order(h, a.id, id, "100.00", flags);
    // A duplicate source row cannot double-count unknown payments or the raw order ledger.
    await order(h, a.id, "gid://shopify/Order/61007", "100.00");
    const requests = mockOrderPaymentSource({
      "61001": { amount: "523.29" }, "61002": { amount: "0.10" }, "61003": { amount: "0.20" },
      "61004": { amount: "12.34", currency: "EUR" }, "61005": { amount: "48.50" }, "61006": { amount: "17.29" },
      "61007": null, "61008": { amount: "0", financialStatus: "AUTHORIZED" }, "61009": { amount: "0", financialStatus: "REFUNDED" },
      "61010": { amount: "45", cancelledAt: ago(0.5).toISOString() }, "61011": { amount: "100", test: true },
      "61012": { amount: "-25", financialStatus: "REFUNDED" },
    });
    const cr = await campaignReport(c.id), welcome = await flowReport("welcome"), abandoned = await flowReport("abandoned-cart");
    const legacy = await cartReport(), analytics = await marketingAnalytics();
    assert.equal(cr.totals.ordered, 4); assert.deepEqual(cr.totals.revenue, { USD: 523.59, EUR: 12.34 });
    assert.equal(cr.orders.find(row => row.orderId === "61001")?.amount, 523.29);
    assert.deepEqual(welcome.totals.revenue, { USD: 48.5 }); assert.equal(welcome.totals.orders, 1);
    assert.deepEqual(abandoned.totals.revenue, { USD: 17.29 }); assert.equal(abandoned.totals.orders, 1);
    assert.equal(legacy.orders[0].amount, 17.29); assert.equal(legacy.rows.reduce((sum, row) => sum + row.orders, 0), 1);
    assert.deepEqual(legacy.rows.find(row => row.key === "first")!.revenue, abandoned.totals.revenue);
    assert.deepEqual(analytics.totals.revenue, { USD: 589.38, EUR: 12.34 });
    assert.deepEqual(analytics.totals.storeRevenue, { USD: 609.38, EUR: 12.34 },
      "store cash includes retained cancelled payment and negative net refund, but excludes Shopify tests");
    assert.equal(analytics.totals.orders, 6); assert.equal(analytics.totals.trackedOrders, 12);
    assert.deepEqual(analytics.rows.find(row => row.key === c.id)!.revenue, cr.totals.revenue);
    assert.deepEqual(analytics.rows.find(row => row.key === "welcome")!.revenue, welcome.totals.revenue);
    assert.deepEqual(analytics.rows.find(row => row.key === "abandoned-cart")!.revenue, abandoned.totals.revenue);
    assert.equal(cr.paymentVerification.unverifiedOrders, 1); assert.equal(analytics.paymentVerification.unverifiedOrders, 1);
    assert.equal(welcome.paymentVerification.unverifiedOrders, 0); assert.equal(abandoned.paymentVerification.unverifiedOrders, 0);
    const stored = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { id: raw.id } });
    assert.equal((stored.payload as { revenue: string }).revenue, "739.40");
    assert.equal(stored.occurredAt.toISOString(), raw.occurredAt.toISOString());
    assert.equal((stored.payload as { payment: { amount: string } }).payment.amount, "523.29");
    assert.equal(requests.flat().length, 12, "all views reuse the compact payment cache, including unavailable order backoff");
    assert.equal(h.emails.length, 0);
  }));

  test("paid revenue: report totals follow capture, partial refund and full refund without changing order chronology", async () => isolated(context(), "paid-updates", async h => {
    await settings(h);
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const c = await campaign(h), p = await h.make("paid-updates@example.com"); await sent(h, p.id, { campaignId: c.id });
    const placedAt = ago(1), version = Date.now() - 60000;
    const source = { "62001": { amount: "0", updatedAt: new Date(version).toISOString(), financialStatus: "AUTHORIZED" } };
    mockOrderPaymentSource(source);
    await h.ingest.ingestShopify("orders/create", "payment-original", {
      id: 62001, name: "#62001", email: p.email!, created_at: placedAt.toISOString(), updated_at: source["62001"].updatedAt,
      total_price: "999.99", currency: "USD", financial_status: "authorized", line_items: [],
    });
    const expect = async (amount: number) => {
      const report = await campaignReport(c.id), analytics = await marketingAnalytics();
      assert.equal(report.totals.ordered, amount > 0 ? 1 : 0);
      assert.deepEqual(report.totals.revenue, amount > 0 ? { USD: amount } : {});
      assert.deepEqual(analytics.totals.revenue, report.totals.revenue);
      assert.deepEqual(analytics.totals.storeRevenue, { USD: amount });
      assert.equal(report.paymentVerification.unverifiedOrders, 0);
      if (amount > 0) assert.equal(report.orders[0].placedAt.toISOString(), placedAt.toISOString());
    };
    await expect(0);
    for (const [index, payment] of [{ amount: "80.00", financialStatus: "PARTIALLY_PAID" },
      { amount: "55.25", financialStatus: "PARTIALLY_REFUNDED" }, { amount: "0", financialStatus: "REFUNDED" }].entries()) {
      const updatedAt = new Date(version + (index + 1) * 1000).toISOString();
      source["62001"] = { ...payment, updatedAt };
      await h.ingest.ingestShopify("orders/updated", `payment-update-${index}`, {
        id: 62001, email: p.email!, updated_at: updatedAt, total_price: "1.00", currency: "EUR",
        financial_status: payment.financialStatus.toLowerCase(), line_items: [],
      });
      await expect(Number(payment.amount));
    }
    await h.ingest.ingestShopify("orders/updated", "payment-delayed-old-capture", {
      id: 62001, email: p.email!, updated_at: new Date(version + 500).toISOString(), financial_status: "paid", line_items: [],
    });
    await expect(0);
    const summary = await h.prisma.marketingEvent.findFirstOrThrow({ where: { shop: h.shop, type: "ORDER" } });
    assert.equal((summary.payload as { revenue: string }).revenue, "999.99");
    assert.equal((summary.payload as { currency: string }).currency, "USD");
    assert.equal(summary.occurredAt.toISOString(), placedAt.toISOString());
    assert.equal(h.emails.length, 0);
  }));

  test("paid revenue: an unverifiable Welcome order outside the reporting period blocks false first orders and warns once", async () => isolated(context(), "paid-prior-unknown", async h => {
    await settings(h);
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const p = await h.make("paid-prior-unknown@example.com");
    await sent(h, p.id, { flowKey: "welcome" }, ago(60));
    await order(h, p.id, "63001", "200", {}, ago(40));
    await order(h, p.id, "gid://shopify/Order/63001", "200", {}, ago(40));
    await order(h, p.id, "63002", "300", {}, ago(1.5));
    await order(h, p.id, "63003", "400", {}, ago(1));
    const requests = mockOrderPaymentSource({ "63001": null, "63002": { amount: "70" }, "63003": { amount: "80" } });
    const welcome = await flowReport("welcome", 7), analytics = await marketingAnalytics(7);
    assert.equal(welcome.totals.orders, 0); assert.deepEqual(welcome.totals.revenue, {});
    assert.equal(welcome.paymentVerification.unverifiedOrders, 1);
    assert.equal(analytics.paymentVerification.unverifiedOrders, 1);
    assert.equal(analytics.rows.find(row => row.key === "welcome")!.orders, 0);
    assert.deepEqual(analytics.totals.storeRevenue, { USD: 150 });
    assert.deepEqual(analytics.totals.revenue, {});
    assert.equal(requests.flat().filter(id => id.endsWith("/63001")).length, 1,
      "parallel first-order checks share the lookup and later views use persisted backoff");
    assert.equal(h.emails.length, 0);
  }));

  test("paid revenue: an expired-cache outage retains verified sales across every report and separates new unknown orders", async () => isolated(context(), "paid-refresh-outage", async h => {
    await settings(h);
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartReport } = await import("../lib/marketing/cart-report");
    const { marketingAnalytics } = await import("../lib/marketing/analytics");
    const c = await campaign(h), source: Record<string, { amount: string }> = {};
    const profiles: { id: string }[] = [];
    for (let index = 0; index < 16; index++) {
      const p = await h.make(`paid-outage-${index}@example.com`), id = String(64000 + index);
      profiles.push(p);
      await sent(h, p.id, index < 8 ? { campaignId: c.id } : { flowKey: index < 12 ? "welcome" : "abandoned-cart" });
      await order(h, p.id, id, "999.99"); source[id] = { amount: "100.00" };
    }
    mockOrderPaymentSource(source);
    const before = await marketingAnalytics();
    assert.equal(before.totals.orders, 16); assert.deepEqual(before.totals.revenue, { USD: 1600 });
    assert.deepEqual(before.paymentVerification, { unverifiedOrders: 0, staleOrders: 0 });
    // These contacts have no previous authoritative payment; a cache fallback may not invent one.
    await order(h, profiles[0].id, "64998", "500");
    await order(h, profiles[12].id, "64999", "500");
    let failedRequests = 0;
    globalThis.fetch = async () => { failedRequests++; throw Error("Temporary Shopify payment outage"); };
    const realNow = Date.now;
    try {
      const later = realNow() + 6 * 60000; Date.now = () => later;
      const analytics = await marketingAnalytics(), cr = await campaignReport(c.id);
      const welcome = await flowReport("welcome"), cart = await flowReport("abandoned-cart"), legacy = await cartReport();
      assert.equal(analytics.totals.orders, 16); assert.deepEqual(analytics.totals.revenue, before.totals.revenue);
      assert.deepEqual(analytics.totals.storeRevenue, before.totals.storeRevenue);
      assert.deepEqual(analytics.paymentVerification, { unverifiedOrders: 2, staleOrders: 16 });
      assert.equal(cr.totals.ordered, 8); assert.deepEqual(cr.totals.revenue, { USD: 800 });
      assert.deepEqual(cr.paymentVerification, { unverifiedOrders: 1, staleOrders: 8 });
      assert.equal(welcome.totals.orders, 4); assert.deepEqual(welcome.totals.revenue, { USD: 400 });
      assert.deepEqual(welcome.paymentVerification, { unverifiedOrders: 0, staleOrders: 4 });
      assert.equal(cart.totals.orders, 4); assert.deepEqual(cart.totals.revenue, { USD: 400 });
      assert.deepEqual(cart.paymentVerification, { unverifiedOrders: 1, staleOrders: 4 });
      assert.deepEqual(legacy.paymentVerification, cart.paymentVerification);
      assert.equal(legacy.rows.reduce((sum, row) => sum + row.orders, 0), 4);
      assert.deepEqual(legacy.rows.find(row => row.key === "first")!.revenue, { USD: 400 });
      assert.equal(failedRequests, 1, "a refresh outage has one scoped backoff, without changing any previously verified sale");
      assert.equal(h.emails.length, 0);
    } finally { Date.now = realNow; }
  }));
}
