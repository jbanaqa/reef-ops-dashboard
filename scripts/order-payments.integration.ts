import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "./cart-launch.integration";
import { runWithMarketingBrand } from "../lib/marketing/context";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const object = (value: unknown) => value as Record<string, unknown>;
const snapshot = (amount = "247.99", sourceUpdatedAt = ago(10), checkedAt = ago(0)) => ({
  amount, currency: "USD", sourceUpdatedAt, checkedAt,
});
const node = (id: string, amount = "247.99", updatedAt = ago(10), currencyCode = "USD") => ({
  id, updatedAt, netPaymentSet: { shopMoney: { amount, currencyCode } },
  displayFinancialStatus: "PAID", cancelledAt: null, test: false,
});
type Respond = (ids: string[]) => unknown | Promise<unknown>;
type Row = Awaited<ReturnType<Context["prisma"]["marketingEvent"]["create"]>>;
type Harness = Context & {
  payments: typeof import("../lib/marketing/order-payments");
  tenant: string;
  calls: string[][];
  respond: (reply: Respond) => void;
  create: (id: string, payload?: Record<string, unknown>, occurredAt?: Date) => Promise<Row>;
  load: (row: Row) => Promise<Row>;
};

async function isolated(context: Context, name: string, work: (h: Harness) => Promise<void>) {
  const keys = ["SPECIES_LIBRARY_SHOP_DOMAIN", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"];
  const previous = keys.map(key => process.env[key]), fetch = globalThis.fetch;
  const tenant = `macroalgaefarms-payments-${name}.myshopify.com`, calls: string[][] = [];
  Object.assign(process.env, { SPECIES_LIBRARY_SHOP_DOMAIN: tenant, MACROALGAE_SHOPIFY_CLIENT_ID: "payment-test",
    MACROALGAE_SHOPIFY_CLIENT_SECRET: "payment-test-secret" });
  let reply: Respond = ids => ({ data: { nodes: ids.map(id => node(id)) } });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith(`https://${tenant}/`), "payment lookup cannot contact another store or an email provider");
    if (url.endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "payment-test", expires_in: 3600 });
    assert.ok(url.endsWith("/admin/api/2026-07/graphql.json"));
    const body = JSON.parse(String(init?.body));
    assert.match(body.query, /query MarketingOrderPayments/);
    assert.match(body.query, /netPaymentSet\s*\{\s*shopMoney/);
    assert.doesNotMatch(body.query, /lineItems|customer|images|addresses|transactions|totalPriceSet/);
    assert.ok(body.variables.ids.length <= 100);
    calls.push(body.variables.ids);
    return Response.json(await reply(body.variables.ids));
  };
  try {
    await runWithMarketingBrand("macroalgae-farms", async () => {
      const payments = await import("../lib/marketing/order-payments");
      const create: Harness["create"] = (id, payload = {}, occurredAt = new Date()) => context.prisma.marketingEvent.create({
        data: { shop: tenant, key: `payment-${name}-${id}-${Math.random()}`, type: "ORDER", occurredAt,
          payload: context.store.json({ orderId: id, revenue: "243.99", currency: "USD", payment: null, ...payload }) },
      });
      await work({ ...context, payments, tenant, calls, respond: value => { reply = value; }, create,
        load: row => context.prisma.marketingEvent.findUniqueOrThrow({ where: { id: row.id } }) });
    });
  } finally {
    globalThis.fetch = fetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
}

export function registerOrderPaymentTests(context: () => Context) {
  test("Order payments: verified signed decimals and chronology validation", async () => {
    const { normalizedOrderPayment, orderPaymentDirtyUpdate, orderPaymentVerification } = await import("../lib/marketing/order-payments");
    for (const amount of ["247.99", "0", "-1.25"]) assert.equal(normalizedOrderPayment(snapshot(amount))?.amount, amount);
    for (const amount of ["", "NaN", "Infinity", "1e2", "1,000", " 12.00", "+1.00", 12])
      assert.equal(normalizedOrderPayment({ ...snapshot(), amount }), null);
    assert.equal(normalizedOrderPayment({ ...snapshot(), currency: "usd" }), null);
    assert.equal(normalizedOrderPayment({ ...snapshot(), sourceUpdatedAt: null }), null);
    assert.equal(normalizedOrderPayment({ ...snapshot(), checkedAt: ago(-10) }), null);
    assert.equal(orderPaymentVerification({ payment: snapshot() }), "verified");
    assert.equal(orderPaymentVerification({ payment: snapshot("42", ago(20), ago(6)) }), "stale");
    assert.equal(orderPaymentVerification({ payment: snapshot(), paymentDirtyAt: ago(2) }), "unverified");
    assert.equal(orderPaymentVerification({ revenue: "999.99", currency: "USD" }), "unverified");
    const dirty = ago(10);
    assert.deepEqual(orderPaymentDirtyUpdate({ paymentDirtyAt: dirty }, new Date(ago(11))), {});
    assert.deepEqual(orderPaymentDirtyUpdate({}, new Date(dirty)), { paymentDirtyAt: dirty });
  });

  test("Order payments: hydrate authoritative net receipts and preserve original facts", async () => isolated(context(), "facts", async h => {
    const row = await h.create("910001", { orderName: "#40735", discountCodes: ["FIRST10"], checkoutKey: "hash-only" });
    const result = (await h.payments.ensureOrderPayments(h.prisma, [row]))[0];
    assert.equal(object(object(result.payload).payment).amount, "247.99");
    const saved = await h.load(row), payload = object(saved.payload);
    assert.equal(payload.revenue, "243.99"); assert.equal(payload.orderName, "#40735");
    assert.deepEqual(payload.discountCodes, ["FIRST10"]); assert.equal(payload.checkoutKey, "hash-only");
    assert.equal(saved.occurredAt.toISOString(), row.occurredAt.toISOString());
    assert.equal(saved.profileId, row.profileId); assert.equal(saved.messageId, row.messageId);
    assert.equal(payload.financialStatus, "paid"); assert.equal(payload.cancelledAt, null); assert.equal(payload.test, false);
    assert.equal(object(result.payload).financialStatus, "paid", "the current report receives newly observed lifecycle fields too");
    assert.equal(h.calls.length, 1);
  }));

  test("Order payments: fresh cache and explicitly disabled refresh make no requests", async () => isolated(context(), "cache", async h => {
    const fresh = snapshot("88.18"), row = await h.create("910002", { payment: fresh, paymentDirtyAt: ago(20) });
    assert.deepEqual(object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload).payment, fresh);
    const cached = snapshot("99.00", ago(20), ago(6)), stale = await h.create("910003", { payment: cached });
    const result = object((await h.payments.ensureOrderPayments(h.prisma, [stale], { refresh: false }))[0].payload);
    assert.deepEqual(result.payment, cached, "refresh age alone cannot erase previously verified receipts");
    assert.equal(result.paymentStale, true);
    assert.equal(h.calls.length, 0);
  }));

  test("Order payments: newer webhook invalidates a fresh cache without changing gross facts", async () => isolated(context(), "dirty", async h => {
    const dirty = ago(5), row = await h.create("910004", { payment: snapshot("200.00", ago(20)), paymentDirtyAt: dirty });
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "432.36", dirty)) } }));
    const payload = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.equal(object(payload.payment).amount, "432.36"); assert.equal(payload.paymentDirtyAt, dirty);
    assert.equal(object((await h.load(row)).payload).revenue, "243.99"); assert.equal(h.calls.length, 1);
  }));

  test("Order payments: expired newer snapshots cannot be replaced by older API replicas", async () => isolated(context(), "older", async h => {
    const verified = snapshot("432.36", ago(10), ago(6));
    const row = await h.create("910005", { payment: verified, financialStatus: "partially_refunded",
      orderStateAt: { financialStatus: verified.sourceUpdatedAt } });
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "375.07", ago(20))) } }));
    const current = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.deepEqual(current.payment, verified, "a failed refresh preserves last verified receipts");
    assert.equal(current.paymentStale, true); assert.match(String(current.paymentError), /older/);
    const saved = object((await h.load(row)).payload);
    assert.deepEqual(saved.payment, verified, "a stale replica cannot destroy a newer monetary observation");
    assert.equal(saved.financialStatus, "partially_refunded"); assert.match(String(saved.paymentError), /older/);
    await h.payments.ensureOrderPayments(h.prisma, [await h.load(row)]); assert.equal(h.calls.length, 1);
  }));

  test("Order payments: in-flight webhook update preserves dirty version and lifecycle evidence", async () => isolated(context(), "race", async h => {
    const row = await h.create("910006", { paymentDirtyAt: ago(20) });
    let began!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const older = ago(15), newer = ago(3);
    h.respond(async ids => { began(); await gate; return { data: { nodes: ids.map(id => node(id, "247.99", older)) } }; });
    const pending = h.payments.ensureOrderPayments(h.prisma, [row]); await started;
    await h.prisma.marketingEvent.update({ where: { id: row.id }, data: { payload: h.store.json({ ...object(row.payload),
      paymentDirtyAt: newer, financialStatus: "refunded", orderStateAt: { financialStatus: newer }, discountCodes: ["NEWCODE"] }) } });
    release();
    const result = object((await pending)[0].payload), saved = object((await h.load(row)).payload);
    assert.equal(result.payment, null); assert.equal(result.financialStatus, "refunded");
    assert.equal(saved.paymentDirtyAt, newer); assert.equal(saved.financialStatus, "refunded"); assert.deepEqual(saved.discountCodes, ["NEWCODE"]);
    assert.match(String(saved.paymentError), /predates/);
  }));

  test("Order payments: independent lifecycle clocks and returned state remain chronological", async () => isolated(context(), "clocks", async h => {
    const newer = ago(3), source = ago(10);
    const row = await h.create("910007", { financialStatus: "refunded", test: true, orderStateAt: { financialStatus: newer, test: newer } });
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "50.00", source)) } }));
    const payload = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.equal(object(payload.payment).amount, "50.00"); assert.equal(payload.financialStatus, "refunded"); assert.equal(payload.test, true);
    assert.equal(payload.cancelledAt, null, "a field without a newer clock can still be filled");
    assert.deepEqual(payload.orderStateAt, { financialStatus: newer, test: newer, cancelledAt: source });
  }));

  test("Order payments: concurrent reports coalesce one lookup for an identical order version", async () => isolated(context(), "coalesce", async h => {
    const row = await h.create("910008", { paymentDirtyAt: ago(20) });
    let began!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    h.respond(async ids => { began(); await gate; return { data: { nodes: ids.map(id => node(id)) } }; });
    const first = h.payments.ensureOrderPayments(h.prisma, [row]); await started;
    const second = h.payments.ensureOrderPayments(h.prisma, [row]);
    // Reach the second call's state read before releasing the first API request.
    await new Promise<void>(resolve => setImmediate(resolve));
    release();
    const results = await Promise.all([first, second]);
    assert.equal(h.calls.length, 1);
    for (const result of results) assert.equal(object(object(result[0].payload).payment).amount, "247.99");
  }));

  test("Order payments: node lookups batch at 100 and persist one compact snapshot per order", async () => isolated(context(), "batch", async h => {
    const rows = await Promise.all(Array.from({ length: 101 }, (_, index) => h.create(String(920000 + index))));
    const result = await h.payments.ensureOrderPayments(h.prisma, rows);
    assert.deepEqual(h.calls.map(ids => ids.length), [100, 1]);
    assert.equal(result.filter(row => object(row.payload).payment !== null).length, 101);
    for (const row of result) assert.deepEqual(Object.keys(object(object(row.payload).payment)).sort(), ["amount", "checkedAt", "currency", "sourceUpdatedAt"]);
  }));

  test("Order payments: shop currency and signed net refunds are retained; malformed money is unknown", async () => isolated(context(), "currency", async h => {
    const ids = ["930001", "930002", "930003", "930004"], rows = await Promise.all(ids.map(id => h.create(id)));
    h.respond(gids => ({ data: { nodes: gids.map((id, index) => node(id, ["60.40", "-25.00", "0", "1e2"][index], ago(10), index ? "USD" : "EUR")) } }));
    const values = (await h.payments.ensureOrderPayments(h.prisma, rows)).map(row => object(row.payload).payment);
    assert.equal(object(values[0]).currency, "EUR"); assert.equal(object(values[1]).amount, "-25.00");
    assert.equal(object(values[2]).amount, "0"); assert.equal(values[3], null);
    assert.match(String(object((await h.load(rows[3])).payload).paymentError), /incomplete or invalid/);
  }));

  test("Order payments: inaccessible orders back off without inventing zero or exposing order data", async () => isolated(context(), "missing", async h => {
    const row = await h.create("940001"); h.respond(() => ({ data: { nodes: [null] } }));
    assert.equal(object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload).payment, null);
    const failed = await h.load(row); assert.match(String(object(failed.payload).paymentError), /unavailable or outside/);
    await h.payments.ensureOrderPayments(h.prisma, [failed]); assert.equal(h.calls.length, 1);
    const newer = ago(0);
    await h.prisma.marketingEvent.update({ where: { id: row.id }, data: { payload: h.store.json({ ...object(failed.payload), paymentDirtyAt: newer }) } });
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "111.11", newer)) } }));
    assert.equal(object(object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload).payment).amount, "111.11");
    assert.equal(h.calls.length, 2, "a new webhook version bypasses a failed per-order lookup backoff");
  }));

  test("Order payments: provider failures have a store-wide retry backoff", async () => isolated(context(), "outage", async h => {
    const first = await h.create("940002"), second = await h.create("940003");
    h.respond(() => { throw Error("Payment service unavailable"); });
    for (const row of [first, second]) {
      const result = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
      assert.equal(result.payment, null); assert.match(String(result.paymentError), /Payment service unavailable/);
    }
    assert.equal(h.calls.length, 1, "a transport outage cannot generate one failed request per row or report");
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.tenant } }), 0);
  }));

  test("Order payments: failed refresh retains the watermark for a later older replica", async () => isolated(context(), "failed-watermark", async h => {
    const verified = snapshot("432.36", ago(10), ago(6)), older = ago(20);
    const row = await h.create("940004", { payment: verified });
    h.respond(() => { throw Error("Temporary payment outage"); });
    const first = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.deepEqual(first.payment, verified); assert.equal(first.paymentStale, true);
    assert.match(String(first.paymentError), /Temporary payment outage/);
    assert.deepEqual(object((await h.load(row)).payload).payment, verified, "the last source version survives failed refreshes");
    const realNow = Date.now;
    try {
      const later = realNow() + 6 * 60000; Date.now = () => later;
      h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "375.07", older)) } }));
      const current = object((await h.payments.ensureOrderPayments(h.prisma, [await h.load(row)]))[0].payload);
      assert.deepEqual(current.payment, verified); assert.equal(current.paymentStale, true); assert.match(String(current.paymentError), /older/);
      assert.deepEqual(object((await h.load(row)).payload).payment, verified);
      assert.equal(h.calls.length, 2);
    } finally { Date.now = realNow; }
  }));

  test("Order payments: refresh outages retain known money but not an invalidated webhook version", async () => isolated(context(), "stale-dirty", async h => {
    const known = snapshot("380.00", ago(20), ago(6));
    const stable = await h.create("940005", { payment: known }), dirty = await h.create("940006", { payment: known, paymentDirtyAt: ago(2) });
    h.respond(() => { throw Error("Payment refresh is unavailable"); });
    const [retained, pending] = (await h.payments.ensureOrderPayments(h.prisma, [stable, dirty])).map(row => object(row.payload));
    assert.deepEqual(retained.payment, known); assert.equal(retained.paymentStale, true);
    assert.match(String(retained.paymentError), /Payment refresh is unavailable/);
    assert.equal(pending.payment, null); assert.equal(pending.paymentStale, false);
    assert.deepEqual(object((await h.load(dirty)).payload).payment, known, "the source version remains recorded while its update awaits verification");
    assert.equal(h.payments.orderPaymentVerification(retained), "stale");
    assert.equal(h.payments.orderPaymentVerification(pending), "unverified");
  }));

  test("Order payments: a later successful refresh clears stale status and the retry error", async () => isolated(context(), "stale-recovery", async h => {
    const known = snapshot("380.00", ago(20), ago(6)), row = await h.create("940007", { payment: known });
    h.respond(() => ({ data: { nodes: [null] } }));
    const retained = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.deepEqual(retained.payment, known); assert.equal(retained.paymentStale, true);
    const saved = await h.load(row);
    await h.prisma.marketingEvent.update({ where: { id: row.id }, data: { payload: h.store.json({ ...object(saved.payload), paymentCheckAt: ago(6) }) } });
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id, "432.36")) } }));
    const refreshed = object((await h.payments.ensureOrderPayments(h.prisma, [row]))[0].payload);
    assert.equal(object(refreshed.payment).amount, "432.36"); assert.equal(refreshed.paymentStale, false); assert.equal(refreshed.paymentError, null);
    assert.equal(h.payments.orderPaymentVerification(refreshed), "verified");
    assert.equal(object((await h.load(row)).payload).paymentError, undefined);
  }));

  test("Order payments: tenant scope cannot hydrate another store's order ID", async () => isolated(context(), "scope", async h => {
    const own = await h.create("950001"), foreign = await runWithMarketingBrand("corals-anonymous", () => h.prisma.marketingEvent.create({
      data: { shop: h.store.shop(), key: "payment-foreign-order", type: "ORDER", occurredAt: new Date(),
        payload: h.store.json({ orderId: "950001", revenue: "123.45", payment: snapshot("123.45") }) },
    }));
    const foreignBefore = await h.load(foreign);
    const hydrated = await h.payments.ensureOrderPayments(h.prisma, [own, foreign]);
    assert.equal(object(hydrated[1].payload).payment, null, "a foreign row cannot be considered verified in this store");
    assert.equal(object(object(hydrated[0].payload).payment).amount, "247.99");
    assert.deepEqual(await h.load(foreign), foreignBefore); assert.equal(h.calls.length, 1);
  }));

  test("Order payments: background sweep is bounded to recent scoped recorded orders", async () => isolated(context(), "sweep", async h => {
    const recent = await h.create("960001"), old = await h.create("960002", {}, new Date(Date.now() - 366 * 86400000));
    await h.create("not-a-shopify-order");
    const result = await h.payments.refreshOrderPayments(500);
    assert.deepEqual(result, { checked: 1, verified: 1, unavailable: 0 });
    assert.equal(object(object((await h.load(recent)).payload).payment).amount, "247.99");
    assert.equal(object((await h.load(old)).payload).payment, null);
    assert.deepEqual(h.calls, [["gid://shopify/Order/960001"]]);
  }));

  test("Order payments: recently attempted stale orders cannot starve other due refreshes", async () => isolated(context(), "sweep-fairness", async h => {
    const failed = await Promise.all(Array.from({ length: 100 }, (_, index) => h.create(String(970000 + index), {
      payment: snapshot("380.00", ago(40), ago(30)),
    })));
    const waiting = await h.create("970100", { payment: snapshot("247.99", ago(40), ago(10)) });
    h.respond(ids => ({ data: { nodes: ids.map(() => null) } }));
    await h.payments.refreshOrderPayments();
    assert.equal(h.calls[0].length, 100);
    assert.ok(!h.calls[0].includes("gid://shopify/Order/970100"));
    for (const row of failed) assert.match(String(object((await h.load(row)).payload).paymentError), /unavailable or outside/);
    // The failed batch's retry delay has elapsed. Its latest attempt is still
    // newer than this other order's verification, so the other order goes first.
    await h.prisma.$executeRaw`UPDATE "MarketingEvent"
      SET payload=payload || jsonb_build_object('paymentCheckAt', ${ago(6)}::text)
      WHERE shop=${h.tenant} AND type='ORDER' AND id<>${waiting.id}`;
    h.respond(ids => ({ data: { nodes: ids.map(id => node(id)) } }));
    await h.payments.refreshOrderPayments(1);
    assert.deepEqual(h.calls[1], ["gid://shopify/Order/970100"]);
    assert.equal(h.payments.orderPaymentVerification((await h.load(waiting)).payload), "verified");
  }));
}
