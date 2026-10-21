import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";

type Harness = Parameters<Parameters<typeof isolated>[2]>[0];
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function reportTest(context: Context, name: string, work: (h: Harness) => Promise<void>) {
  await isolated(context, "welcome-credit-" + name, async h => {
    globalThis.fetch = async () => { throw Error("Attribution reports cannot call a provider or Shopify"); };
    await h.prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
      create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Attribution settings", data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } },
      update: { data: { attribution: { emailOpenDays: 7, emailClickDays: 7 } } } });
    await work(h);
    assert.equal(h.emails.length, 0);
  });
}
async function run(h: Harness, profileId: string, enteredAt: Date, extra: Record<string, unknown> = {}) {
  return h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_RUN", key: profileId,
    name: "Customer Welcome enrollment", data: h.store.json({ profileId, enteredAt: enteredAt.toISOString(), ...extra }) } });
}
async function message(h: Harness, profileId: string, sentAt: Date, options: {
  step?: number; triggerAt?: Date | null; campaignId?: string; flowKey?: string; status?: string;
} = {}) {
  const step = options.step ?? 0;
  return h.prisma.marketingMessage.create({ data: { shop: h.shop, profileId,
    key: `welcome-credit:${profileId}:${crypto.randomUUID()}`, flowKey: options.campaignId ? null : options.flowKey || "welcome",
    campaignId: options.campaignId, flowStep: step, flowCondition: `welcome-v1:${step}`, channel: "EMAIL",
    subject: `Welcome step ${step + 1}`, content: defaultContent, status: options.status || "SENT", sentAt, dueAt: sentAt,
    triggerAt: options.triggerAt === undefined ? ago(4) : options.triggerAt,
  } });
}
async function event(h: Harness, profileId: string, type: string, at: Date, payload: Record<string, unknown> = {}, messageId?: string) {
  return h.store.atomic(tx => h.store.record(tx, { key: `${h.shop}:${type}:${crypto.randomUUID()}`, type, profileId,
    occurredAt: at, payload: h.store.json(payload), messageId }));
}
async function order(h: Harness, profileId: string, id: string, at: Date, extra: Record<string, unknown> = {}) {
  return event(h, profileId, "ORDER", at, { orderId: id, orderLabel: "#" + id.replace(/^gid:\/\/shopify\/Order\//, ""),
    revenue: "100", currency: "USD", ...extra });
}
async function coupon(h: Harness, profileId: string, code = "WELCOME-ASSIGNED", extra: Record<string, unknown> = {}) {
  return h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_COUPON", key: profileId,
    name: "Assigned Welcome code", data: h.store.json({ code, ...extra }) } });
}
async function reports(h: Harness, expected: string[], amount: number) {
  const { flowReport } = await import("../lib/marketing/flow-report");
  const { marketingAnalytics } = await import("../lib/marketing/analytics");
  const flow = await flowReport("welcome"), analytics = await marketingAnalytics(), row = analytics.rows.find(item => item.key === "welcome")!;
  assert.deepEqual(flow.orders.map(item => item.label).sort(), expected.sort());
  assert.equal(flow.totals.orders, expected.length); assert.equal(row.orders, flow.totals.orders);
  assert.deepEqual(row.revenue, flow.totals.revenue);
  assert.equal(Object.values(flow.totals.revenue).reduce((sum, value) => sum + value, 0), amount);
  assert.equal(row.convertedRecipients, flow.totals.convertedRecipients);
  return flow;
}

export function registerWelcomeAttributionTests(context: () => Context) {
  test("Welcome attribution: only the first positive post-signup order earns ordinary Welcome credit", async () => reportTest(context(), "first", async h => {
    const p = await h.make("first-welcome@example.com"); await run(h, p.id, ago(4));
    const m = await message(h, p.id, ago(3)); await event(h, p.id, "OPENED", ago(2.5), {}, m.id);
    await order(h, p.id, "101", ago(2), { revenue: "59.95" });
    await order(h, p.id, "102", ago(1.5), { revenue: "123" });
    await order(h, p.id, "103", ago(1), { revenue: "0" });
    const flow = await reports(h, ["#101"], 59.95);
    assert.equal(flow.orders[0].welcomeReason, "FIRST_ORDER");
    assert.equal(flow.orders[0].interaction, "OPENED");
    assert.equal(flow.totals.convertedRecipients, 1);
    const { findEmailAttribution } = await import("../lib/marketing/attribution");
    assert.equal(await findEmailAttribution(h.prisma, p.id, ago(1)), null,
      "a caller without order evidence cannot bypass Welcome's first-order rule");
  }));

  test("Welcome attribution: zero and malformed amounts never consume the first qualifying order", async () => reportTest(context(), "zero", async h => {
    const p = await h.make("zero-welcome@example.com"); await run(h, p.id, ago(4));
    const m = await message(h, p.id, ago(3)); await event(h, p.id, "OPENED", ago(2.8), {}, m.id);
    for (const [index, revenue] of ["0", "not-money", "", null, "-1"].entries())
      await order(h, p.id, String(200 + index), ago(2.5 - index / 10), { revenue });
    await order(h, p.id, "210", ago(1.5), { revenue: "35" });
    await order(h, p.id, "211", ago(1), { revenue: "50" });
    await reports(h, ["#210"], 35);
  }));

  test("Welcome attribution: purchases before email delivery consume the first-order slot", async () => reportTest(context(), "pre-send", async h => {
    const p = await h.make("presend-welcome@example.com"); await run(h, p.id, ago(5));
    await order(h, p.id, "301", ago(6));
    await order(h, p.id, "302", ago(4));
    const m = await message(h, p.id, ago(3)); await event(h, p.id, "OPENED", ago(2.5), {}, m.id);
    await order(h, p.id, "303", ago(2));
    await reports(h, [], 0);
  }));

  test("Welcome attribution: first-order history is not reset by a shorter reporting period", async () => reportTest(context(), "history", async h => {
    const p = await h.make("history-welcome@example.com"); await run(h, p.id, ago(60));
    await message(h, p.id, ago(55), { triggerAt: ago(60) });
    await order(h, p.id, "401", ago(50));
    const m = await message(h, p.id, ago(3), { step: 1, triggerAt: ago(60) });
    await event(h, p.id, "OPENED", ago(2.5), {}, m.id); await order(h, p.id, "402", ago(2));
    await reports(h, [], 0);
  }));

  test("Welcome attribution: out-of-order arrival and canonical Shopify IDs cannot double-count the first order", async () => reportTest(context(), "late-orders", async h => {
    const p = await h.make("lateorders-welcome@example.com"); await run(h, p.id, ago(5));
    const m = await message(h, p.id, ago(4)); await event(h, p.id, "OPENED", ago(3.5), {}, m.id);
    await order(h, p.id, "502", ago(2), { revenue: "80" });
    await reports(h, ["#502"], 80);
    await order(h, p.id, "501", ago(3), { revenue: "25" });
    await order(h, p.id, "gid://shopify/Order/501", ago(3), { revenue: "25" });
    await reports(h, ["#501"], 25);
  }));

  test("Welcome attribution: assigned-code repeat purchases require no open and take one cross-channel credit", async () => reportTest(context(), "code-priority", async h => {
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const p = await h.make("code-welcome@example.com"); await run(h, p.id, ago(21));
    await order(h, p.id, "601", ago(20.5));
    const offer = await message(h, p.id, ago(20), { triggerAt: ago(21) });
    await coupon(h, p.id, "WELCOME-ASSIGNED", { startsAt: ago(21).toISOString(), endsAt: ago(0.25).toISOString() });
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Other campaign", subject: "Other", content: defaultContent, audience: {}, status: "COMPLETED" } });
    const other = await message(h, p.id, ago(2), { campaignId: campaign.id });
    await event(h, p.id, "OPENED", ago(1.5), {}, other.id);
    await order(h, p.id, "602", ago(1), { revenue: "72", discountCodes: [" welcome-assigned ", "WELCOME-ASSIGNED", "OTHER"] });
    const flow = await reports(h, ["#602"], 72);
    assert.equal(flow.orders[0].interaction, "COUPON"); assert.equal(flow.orders[0].welcomeReason, "WELCOME_CODE");
    assert.equal(flow.orders[0].sentAt, offer.sentAt!.toISOString());
    assert.equal((await campaignReport(campaign.id)).totals.ordered, 0);
    assert.deepEqual(flow.orders[0].discountCodes, ["WELCOME-ASSIGNED"]);
  }));

  for (const invalid of ["wrong-code", "prefix", "another-profile", "before-start", "expired", "social-only"] as const) {
    test(`Welcome attribution: ${invalid} is not assigned offer-code evidence`, async () => reportTest(context(), "code-" + invalid, async h => {
      const p = await h.make(`invalid-${invalid}@example.com`); await run(h, p.id, ago(5));
      await order(h, p.id, "701", ago(4));
      await message(h, p.id, ago(3), { step: invalid === "social-only" ? 3 : 0 });
      const fields = invalid === "before-start" ? { startsAt: ago(0.5).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() }
        : invalid === "expired" ? { startsAt: ago(5).toISOString(), endsAt: ago(2).toISOString() } : {};
      if (invalid === "another-profile") {
        const owner = await h.make("other-code-owner@example.com"); await coupon(h, owner.id);
      } else await coupon(h, p.id, "WELCOME-ASSIGNED", fields);
      const code = invalid === "wrong-code" ? "OTHER" : invalid === "prefix" ? "WELCOME-ASSIGNED-FAKE" : "WELCOME-ASSIGNED";
      await order(h, p.id, "702", ago(1), { discountCodes: [code] });
      await reports(h, [], 0);
    }));
  }

  test("Welcome attribution: repeat orders cannot let a later Welcome open steal another flow's sale", async () => reportTest(context(), "repeat-last-touch", async h => {
    const p = await h.make("repeat-touch@example.com"); await run(h, p.id, ago(6));
    await order(h, p.id, "801", ago(5));
    const welcome = await message(h, p.id, ago(4));
    const cart = await message(h, p.id, ago(3), { flowKey: "abandoned-cart" });
    await event(h, p.id, "OPENED", ago(2.5), {}, cart.id);
    await event(h, p.id, "OPENED", ago(2), {}, welcome.id);
    await order(h, p.id, "802", ago(1));
    await reports(h, [], 0);
    const { flowReport } = await import("../lib/marketing/flow-report");
    assert.equal((await flowReport("abandoned-cart")).totals.orders, 1);
  }));

  test("Welcome attribution: restricted tests cannot claim code revenue from customer campaigns", async () => reportTest(context(), "restricted", async h => {
    const { campaignReport } = await import("../lib/marketing/campaign-report");
    const p = await h.make("restricted-code@example.com"); await run(h, p.id, ago(5), { testEmail: p.email });
    await message(h, p.id, ago(4)); await coupon(h, p.id);
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Customer campaign", subject: "Campaign", content: defaultContent, audience: {}, status: "COMPLETED" } });
    const real = await message(h, p.id, ago(3), { campaignId: campaign.id });
    await event(h, p.id, "OPENED", ago(2), {}, real.id);
    await order(h, p.id, "901", ago(1), { discountCodes: ["WELCOME-ASSIGNED"] });
    await reports(h, [], 0); assert.equal((await campaignReport(campaign.id)).totals.ordered, 1);
  }));

  test("Welcome attribution: verified signup baselines use enrollment, event, or legacy trigger; absent proof does not guess", async () => reportTest(context(), "baseline", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    for (const baseline of ["run", "event", "trigger", "none"] as const) {
      const p = await h.make(`baseline-${baseline}@example.com`);
      if (baseline === "run") await run(h, p.id, ago(4));
      if (baseline === "event") await event(h, p.id, "WELCOME_ENTERED", ago(4), { test: false });
      const m = await message(h, p.id, ago(3), { triggerAt: baseline === "trigger" ? ago(4) : null });
      await event(h, p.id, "OPENED", ago(2), {}, m.id);
      await order(h, p.id, "100" + ["run", "event", "trigger", "none"].indexOf(baseline), ago(1));
    }
    const flow = await flowReport("welcome");
    assert.equal(flow.totals.orders, 3); assert.equal(flow.orders.some(item => item.email === "baseline-none@example.com"), false);
  }));

  test("Welcome attribution: an assigned code cannot turn a zero-dollar checkout into a sale", async () => reportTest(context(), "zero-code", async h => {
    const p = await h.make("zero-code@example.com"); await run(h, p.id, ago(4));
    const m = await message(h, p.id, ago(3)); await coupon(h, p.id);
    await event(h, p.id, "OPENED", ago(2.5), {}, m.id);
    await order(h, p.id, "1101", ago(2), { revenue: "0", discountCodes: ["WELCOME-ASSIGNED"] });
    await reports(h, [], 0);
  }));

  test("Welcome attribution: an expired engagement window cannot credit an ordinary first order", async () => reportTest(context(), "engagement-window", async h => {
    const p = await h.make("window-welcome@example.com"); await run(h, p.id, ago(21));
    const m = await message(h, p.id, ago(20), { triggerAt: ago(21) });
    await event(h, p.id, "OPENED", ago(1.5), {}, m.id);
    await order(h, p.id, "1151", ago(1));
    await reports(h, [], 0);
  }));

  test("Welcome attribution: allocating a new code cannot make an older email proof that the code was sent", async () => reportTest(context(), "code-allocation", async h => {
    const p = await h.make("allocation-welcome@example.com"); await run(h, p.id, ago(6));
    await order(h, p.id, "1160", ago(5));
    await message(h, p.id, ago(4));
    await coupon(h, p.id, "WELCOME-ASSIGNED", { startsAt: ago(3).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() });
    await order(h, p.id, "1161", ago(1), { discountCodes: ["WELCOME-ASSIGNED"] });
    await reports(h, [], 0);
    const reminder = await message(h, p.id, ago(2), { step: 1 });
    const flow = await reports(h, ["#1161"], 100);
    assert.equal(flow.orders[0].sentAt, reminder.sentAt!.toISOString());
  }));

  test("Welcome attribution: cancelled, test, voided and refunded orders do not consume the first qualifying order", async () => reportTest(context(), "order-state", async h => {
    const p = await h.make("state-welcome@example.com"); await run(h, p.id, ago(5));
    const m = await message(h, p.id, ago(4)); await event(h, p.id, "OPENED", ago(3.5), {}, m.id); await coupon(h, p.id);
    const states = [{ test: true }, { cancelledAt: ago(3).toISOString() }, { financialStatus: "voided" }, { financialStatus: "refunded" }];
    for (let index = 0; index < states.length; index++) await order(h, p.id, String(1200 + index), ago(3 - index / 10),
      { ...states[index], discountCodes: ["WELCOME-ASSIGNED"] });
    await reports(h, [], 0);
    await order(h, p.id, "1210", ago(2), { revenue: "48", financialStatus: "pending" });
    await order(h, p.id, "1211", ago(1), { revenue: "99" });
    await reports(h, ["#1210"], 48);
  }));

  test("Welcome attribution: Shopify lifecycle updates remove invalid sales without rewriting original money or time", async () => reportTest(context(), "state-update", async h => {
    const p = await h.make("state-update-welcome@example.com"); await run(h, p.id, ago(5));
    const m = await message(h, p.id, ago(4)); await event(h, p.id, "OPENED", ago(3.5), {}, m.id);
    const placedAt = ago(2);
    await h.ingest.ingestShopify("orders/create", "welcome-state-order", {
      id: 1301, name: "#1301", email: p.email!, created_at: placedAt.toISOString(), total_price: "55", currency: "USD",
      financial_status: "paid", cancelled_at: null, test: false, line_items: [],
    });
    await reports(h, ["#1301"], 55);
    await h.ingest.ingestShopify("orders/updated", "welcome-state-refunded", {
      id: 1301, email: p.email!, created_at: ago(1).toISOString(), updated_at: new Date().toISOString(),
      total_price: "999", currency: "EUR", financial_status: "refunded", line_items: [],
    });
    await reports(h, [], 0);
    await h.ingest.ingestShopify("orders/updated", "welcome-state-out-of-order-paid", {
      id: 1301, email: p.email!, updated_at: ago(0.25).toISOString(), financial_status: "paid", cancelled_at: null, line_items: [],
    });
    await reports(h, [], 0);
    await h.ingest.ingestShopify("orders/updated", "welcome-state-partial-update", {
      id: 1301, email: p.email!, updated_at: new Date().toISOString(), line_items: [],
    });
    const stored = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { shop_key: { shop: h.shop, key: "order:1301" } } });
    const data = stored.payload as { revenue: string; currency: string; financialStatus: string };
    assert.equal(data.financialStatus, "refunded"); assert.equal(data.revenue, "55"); assert.equal(data.currency, "USD");
    assert.equal(stored.occurredAt.toISOString(), placedAt.toISOString());
    await reports(h, [], 0);
  }));

  test("Welcome attribution: an unrelated newer partial field cannot hide a delayed refund update", async () => reportTest(context(), "state-field-clock", async h => {
    const p = await h.make("field-clock-welcome@example.com"); await run(h, p.id, ago(6));
    const m = await message(h, p.id, ago(5)); await event(h, p.id, "OPENED", ago(4.5), {}, m.id);
    const placedAt = ago(4), paidAt = ago(3), refundedAt = ago(2), partialAt = ago(1);
    await h.ingest.ingestShopify("orders/create", "welcome-field-clock-create", {
      id: 1401, name: "#1401", email: p.email!, created_at: placedAt.toISOString(), updated_at: paidAt.toISOString(),
      total_price: "65", currency: "USD", financial_status: "paid", test: false, line_items: [],
    });
    await reports(h, ["#1401"], 65);
    await h.ingest.ingestShopify("orders/updated", "welcome-field-clock-newer-test-flag", {
      id: 1401, email: p.email!, updated_at: partialAt.toISOString(), test: false, line_items: [],
    });
    await h.ingest.ingestShopify("orders/updated", "welcome-field-clock-delayed-refund", {
      id: 1401, email: p.email!, updated_at: refundedAt.toISOString(), financial_status: "refunded", line_items: [],
    });
    const stored = await h.prisma.marketingEvent.findUniqueOrThrow({ where: { shop_key: { shop: h.shop, key: "order:1401" } } });
    assert.equal((stored.payload as { financialStatus: string }).financialStatus, "refunded");
    assert.equal((stored.payload as { test: boolean }).test, false);
    assert.equal(stored.occurredAt.toISOString(), placedAt.toISOString());
    await reports(h, [], 0);
  }));
}
