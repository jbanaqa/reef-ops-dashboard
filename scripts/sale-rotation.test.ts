import assert from "node:assert/strict";
import test from "node:test";

import { buildSaleSelection, type SaleRotationPlanProduct } from "../lib/sale-rotation-plan";
import { isDashboardMutationAuthorized } from "../lib/dashboard-request-auth";

const settings = { discountCount5: 30, discountCount10: 17, discountCount15: 9, discountCount20: 4 };

function product(id: number, options: Partial<SaleRotationPlanProduct> = {}): SaleRotationPlanProduct {
  return {
    id: String(id),
    shopifyProductId: `gid://shopify/Product/${id}`,
    active: true,
    twentyPercentCandidate: false,
    fixedInSale: false,
    ...options,
  };
}

test("allocates exactly 60 products across configured tiers", () => {
  const products = [
    ...Array.from({ length: 70 }, (_, index) => product(index + 1)),
    ...Array.from({ length: 8 }, (_, index) => product(100 + index, { twentyPercentCandidate: true })),
  ];
  const plan = buildSaleSelection(products, settings, new Map(), () => 0.25);
  const counts = new Map<number, number>();
  for (const discount of plan.selected.values()) counts.set(discount, (counts.get(discount) ?? 0) + 1);
  assert.equal(plan.selected.size, 60);
  assert.deepEqual(Object.fromEntries(counts), { 5: 30, 10: 17, 15: 9, 20: 4 });
});

test("always includes fixed 20 percent products and fills remaining slots", () => {
  const fixed = [product(101, { twentyPercentCandidate: true, fixedInSale: true }), product(102, { twentyPercentCandidate: true, fixedInSale: true })];
  const rotating = Array.from({ length: 5 }, (_, index) => product(200 + index, { twentyPercentCandidate: true }));
  const standard = Array.from({ length: 56 }, (_, index) => product(index + 1));
  const plan = buildSaleSelection([...standard, ...fixed, ...rotating], settings, new Map(), () => 0.5);
  assert.equal(plan.selected.get("101"), 20);
  assert.equal(plan.selected.get("102"), 20);
  assert.equal(plan.twentyPercentProducts.length, 4);
  assert.deepEqual(plan.twentyPercentProducts.slice(0, 2).map((item) => item.id), ["101", "102"]);
});

test("selects products that have never or least recently appeared", () => {
  const standard = Array.from({ length: 60 }, (_, index) => product(index + 1));
  const twenty = Array.from({ length: 4 }, (_, index) => product(100 + index, { twentyPercentCandidate: true }));
  const history = new Map(standard.map((item, index) => [item.id, index < 4 ? 10_000 + index : index]));
  const plan = buildSaleSelection([...standard, ...twenty], settings, history, () => 0.1);
  for (const recentlyUsed of ["1", "2", "3", "4"]) assert.equal(plan.selected.has(recentlyUsed), false);
});

test("rejects too many fixed products", () => {
  const standard = Array.from({ length: 56 }, (_, index) => product(index + 1));
  const fixed = Array.from({ length: 5 }, (_, index) => product(100 + index, { twentyPercentCandidate: true, fixedInSale: true }));
  assert.throws(() => buildSaleSelection([...standard, ...fixed], settings, new Map()), /fixed 20% products/);
});

test("rejects undersized standard and 20 percent pools", () => {
  const standard = Array.from({ length: 55 }, (_, index) => product(index + 1));
  const twenty = Array.from({ length: 4 }, (_, index) => product(100 + index, { twentyPercentCandidate: true }));
  assert.throws(() => buildSaleSelection([...standard, ...twenty], settings, new Map()), /requires 56 standard products/);
  assert.throws(() => buildSaleSelection(Array.from({ length: 56 }, (_, index) => product(index + 1)), settings, new Map()), /requires 4 rotating 20% products/);
});

test("requires dashboard credentials and rejects cross-origin mutations", () => {
  const previous = {
    disabled: process.env.DASHBOARD_AUTH_DISABLED,
    username: process.env.DASHBOARD_USERNAME,
    password: process.env.DASHBOARD_PASSWORD,
  };
  process.env.DASHBOARD_AUTH_DISABLED = "false";
  process.env.DASHBOARD_USERNAME = "operator";
  process.env.DASHBOARD_PASSWORD = "secret";
  const authorization = `Basic ${Buffer.from("operator:secret").toString("base64")}`;
  try {
    assert.equal(isDashboardMutationAuthorized(new Request("https://reef.example/api/sale-rotation/run", { headers: { authorization, origin: "https://reef.example" } })), true);
    assert.equal(isDashboardMutationAuthorized(new Request("https://reef.example/api/sale-rotation/run", { headers: { authorization, origin: "https://attacker.example" } })), false);
    assert.equal(isDashboardMutationAuthorized(new Request("https://reef.example/api/sale-rotation/run", { headers: { origin: "https://reef.example" } })), false);
  } finally {
    if (previous.disabled === undefined) delete process.env.DASHBOARD_AUTH_DISABLED; else process.env.DASHBOARD_AUTH_DISABLED = previous.disabled;
    if (previous.username === undefined) delete process.env.DASHBOARD_USERNAME; else process.env.DASHBOARD_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previous.password;
  }
});
