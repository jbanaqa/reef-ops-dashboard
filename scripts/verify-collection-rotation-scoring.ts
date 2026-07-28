import assert from "node:assert/strict";

import {
  scoreProducts,
  STRATEGY_PRESETS,
} from "../lib/collection-rotation-scoring";

const products = [
  { id: "gid://shopify/Product/1", legacyResourceId: "1", title: "A", createdAt: new Date("2026-07-20") },
  { id: "gid://shopify/Product/2", legacyResourceId: "2", title: "B", createdAt: new Date("2026-06-01") },
  { id: "gid://shopify/Product/3", legacyResourceId: "3", title: "C", createdAt: new Date("2026-01-01") },
];
const metric = (
  productId: string,
  unitsSold: number,
  priorUnitsSold = unitsSold,
  availableInventory = unitsSold * 4,
  unexplainedShrinkage = 0
) => ({
  productId,
  productViews: unitsSold * 10,
  listViews: unitsSold * 20,
  listClicks: unitsSold * 5,
  addsToCart: unitsSold * 2,
  purchases: unitsSold,
  unitsSold,
  revenue: unitsSold * 25,
  priorUnitsSold,
  hasPriorWindowData: true,
  availableInventory,
  hasInventoryData: true,
  unexplainedShrinkage,
  sources: ["SHOPIFY_REPORTS"],
  newestSyncAt: "2026-07-26T00:00:00.000Z",
});
const metrics = new Map([
  ["1", metric("1", 8, 3, 10)], // accelerating, thin stock
  ["2", metric("2", 3, 6, 40)], // decelerating, well-stocked
  ["3", metric("3", 1, 1, 4, 0)], // flat
]);
const input = {
  products,
  metrics,
  runOrders: [
    ["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/3"],
    ["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/3"],
  ],
  weights: STRATEGY_PRESETS.BALANCED,
  seed: "verification",
  now: new Date("2026-07-27T00:00:00.000Z"),
};
const first = scoreProducts(input);
const second = scoreProducts(input);

assert.deepEqual(first, second, "The same seed must produce a stable preview.");
assert.equal(first.length, products.length);
assert.deepEqual(
  [...first.map((score) => score.proposedPosition)].sort((a, b) => a - b),
  [1, 2, 3],
  "Every product must receive one proposed position."
);
assert.ok(
  first.every((score) => score.score >= 0 && score.score <= 100),
  "All scores must stay within the explainable 0–100 range."
);
assert.throws(
  () =>
    scoreProducts({
      ...input,
      weights: { performance: 40, exposure: 30, freshness: 10, exploration: 10 },
    }),
  /add up to 100/
);

console.log("Collection rotation scoring verification passed.");
