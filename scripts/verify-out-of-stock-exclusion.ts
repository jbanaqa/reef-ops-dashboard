import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// Simulates exactly what lib/collection-rotation-plan.ts now does: filter
// out confirmed-out-of-stock products BEFORE calling scoreProducts, rather
// than scoring everyone and sorting out-of-stock products to the bottom
// afterward. This proves two things: (1) an out-of-stock product no longer
// shows up in the scored output at all, and (2) removing it from the pool
// changes the percentile-rank baseline the remaining in-stock products are
// measured against (which is the whole point - a huge out-of-stock seller's
// historical unitsSold/revenue no longer inflates the bar everyone else is
// ranked relative to).

const products = [
  { id: "A", legacyResourceId: "A", title: "Huge historical seller, now out of stock", createdAt: new Date("2026-01-01") },
  { id: "B", legacyResourceId: "B", title: "Modest in-stock seller", createdAt: new Date("2026-01-01") },
  { id: "C", legacyResourceId: "C", title: "Weaker in-stock seller", createdAt: new Date("2026-01-01") },
];

const base = (overrides: any) => ({
  productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
  hasPriorWindowData: true, currentWindowCoverage: 1, priorWindowCoverage: 1,
  hasCoverageData: true, unexplainedShrinkage: 0,
  sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
  ...overrides,
});

const metrics = new Map([
  ["A", base({ productId: "A", purchases: 100, unitsSold: 100, revenue: 3000, priorUnitsSold: 90, availableInventory: 0, hasInventoryData: true })],
  ["B", base({ productId: "B", purchases: 10, unitsSold: 10, revenue: 300, priorUnitsSold: 9, availableInventory: 20, hasInventoryData: true })],
  ["C", base({ productId: "C", purchases: 5, unitsSold: 5, revenue: 150, priorUnitsSold: 4, availableInventory: 15, hasInventoryData: true })],
]);

function isConfirmedOutOfStock(productId: string) {
  const metric = metrics.get(productId);
  return Boolean(metric?.hasInventoryData) && (metric?.availableInventory ?? 0) <= 0;
}

const scoreArgs = {
  metrics,
  runOrders: [],
  weights: STRATEGY_PRESETS.PERFORMANCE,
  seed: "oos-exclusion-verification",
  now: new Date("2026-07-28T00:00:00.000Z"),
};

// OLD behavior: score everyone, including the out-of-stock product.
const oldWayScores = scoreProducts({ products, ...scoreArgs });

// NEW behavior: filter out confirmed-out-of-stock products first.
const inStockProducts = products.filter((product) => !isConfirmedOutOfStock(product.id));
const newWayScores = scoreProducts({ products: inStockProducts, ...scoreArgs });

console.log(
  "Old way (A included):",
  oldWayScores.map((s) => ({ title: s.title, unitsRank: s.breakdown.performance.unitsRank }))
);
console.log(
  "New way (A excluded):",
  newWayScores.map((s) => ({ title: s.title, unitsRank: s.breakdown.performance.unitsRank }))
);

// 1. The out-of-stock product must not appear in the new scoring at all.
assert.ok(
  !newWayScores.some((s) => s.title.includes("out of stock")),
  "Out-of-stock product should be completely excluded from scoring"
);
assert.equal(newWayScores.length, 2, "Only the 2 in-stock products should be scored");

// 2. Excluding it should change the in-stock products' percentile ranks -
// with only 2 products left, B (the higher of the two) should land at the
// 100th percentile instead of being squeezed between A and C.
const newB = newWayScores.find((s) => s.title === "Modest in-stock seller")!;
const oldB = oldWayScores.find((s) => s.title === "Modest in-stock seller")!;
assert.ok(
  newB.breakdown.performance.unitsRank > oldB.breakdown.performance.unitsRank,
  `Expected B's rank to rise once the bigger out-of-stock seller is removed from the baseline, got old=${oldB.breakdown.performance.unitsRank} new=${newB.breakdown.performance.unitsRank}`
);
assert.equal(
  newB.breakdown.performance.unitsRank,
  100,
  "With only 2 in-stock products left, the better one should sit at the 100th percentile"
);

console.log("Out-of-stock exclusion verification passed.");
