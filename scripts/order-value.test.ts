import test from "node:test";
import assert from "node:assert/strict";
import { addOrderRevenue, orderValue, qualifyingOrder } from "../lib/marketing/order-evidence";

test("revenue uses verified payment money rather than the original order total", () => {
  const payload = { revenue: "375.07", currency: "USD", payment: { amount: "432.36", currency: "USD" } };
  assert.deepEqual(orderValue(payload), { amount: 432.36, currency: "USD" });
  assert.deepEqual(orderValue({ revenue: "375.07", currency: "USD" }), { amount: null, currency: null });
  assert.deepEqual(orderValue({ ...payload, payment: null }), { amount: null, currency: null });
});

test("uncollected, refunded and invalid payment values are not positive conversions", () => {
  assert.deepEqual(orderValue({ payment: { amount: "0.00", currency: "USD" } }), { amount: 0, currency: "USD" });
  assert.equal(qualifyingOrder({ payment: { amount: "0.00", currency: "USD" } }), false);
  assert.deepEqual(orderValue({ payment: { amount: "-1.25", currency: "USD" } }), { amount: -1.25, currency: "USD" });
  assert.equal(qualifyingOrder({ payment: { amount: "-1.25", currency: "USD" } }), false);
  for (const amount of ["", " ", "0x10", "NaN", "Infinity", null, {}, "1e400"])
    assert.deepEqual(orderValue({ payment: { amount, currency: "USD" } }), { amount: null, currency: null });
  for (const currency of ["UNKNOWN", "usd", "", null])
    assert.deepEqual(orderValue({ payment: { amount: "12.34", currency } }), { amount: null, currency: null });
  assert.equal(qualifyingOrder({ payment: { amount: "122.35", currency: "USD" }, financialStatus: "partially_refunded" }), true);
  assert.equal(qualifyingOrder({ payment: { amount: "122.35", currency: "USD" }, cancelledAt: "2026-10-22T12:00:00Z" }), false);
});

test("paid revenue sums exactly while preserving separate currencies", () => {
  const totals: Record<string, number> = {};
  for (const amount of ["0.10", "0.20", "214.36", "432.36"])
    addOrderRevenue(totals, { payment: { amount, currency: "USD" } });
  addOrderRevenue(totals, { payment: { amount: "125.001", currency: "KWD" } });
  addOrderRevenue(totals, { payment: { amount: "0.002", currency: "KWD" } });
  addOrderRevenue(totals, { payment: { amount: "-1.25", currency: "USD" } });
  addOrderRevenue(totals, { revenue: "999.00", currency: "USD" });
  assert.deepEqual(totals, { USD: 645.77, KWD: 125.003 });
});
