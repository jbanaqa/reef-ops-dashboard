import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// Performance scoring used to include a Sales Momentum sub-metric (this
// script's original purpose - hence the filename). Momentum was retired
// entirely: real-world use showed it was too easily thrown off by small
// sample sizes and restock timing to be a reliable signal. This script now
// verifies that retirement actually took - i.e. that priorUnitsSold,
// hasPriorWindowData, currentWindowCoverage, priorWindowCoverage,
// hasCoverageData, availableInventory, hasInventoryData, and
// unexplainedShrinkage (the old momentum/sell-through inputs) have ZERO
// influence on Performance now, and that Performance is purely a 60/40 blend
// of Units Sold and Revenue.

const products = [
  { id: "gid://shopify/Product/1", legacyResourceId: "1", title: "Same sales, thin/stale historical data", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/2", legacyResourceId: "2", title: "Same sales, rich/healthy historical data", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/3", legacyResourceId: "3", title: "Different sales, for a real percentile spread", createdAt: new Date("2026-01-01") },
];

const metrics = new Map([
  [
    "1",
    {
      productId: "1",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 10, unitsSold: 10, revenue: 200,
      // Deliberately extreme/implausible momentum + sell-through inputs -
      // if these still influenced Performance, product 1 and product 2 below
      // (identical unitsSold/revenue) would NOT score identically.
      priorUnitsSold: 999, hasPriorWindowData: true,
      currentWindowCoverage: 0.01, priorWindowCoverage: 0.01, hasCoverageData: true,
      availableInventory: 0, hasInventoryData: true, unexplainedShrinkage: 50,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "2",
    {
      productId: "2",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 10, unitsSold: 10, revenue: 200,
      priorUnitsSold: 0, hasPriorWindowData: false,
      currentWindowCoverage: 1, priorWindowCoverage: 1, hasCoverageData: false,
      availableInventory: 1000, hasInventoryData: false, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "3",
    {
      productId: "3",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 2, unitsSold: 2, revenue: 30,
      priorUnitsSold: 2, hasPriorWindowData: true,
      currentWindowCoverage: 1, priorWindowCoverage: 1, hasCoverageData: true,
      availableInventory: 40, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
]);

const scores = scoreProducts({
  products,
  metrics,
  runOrders: [],
  weights: STRATEGY_PRESETS.PERFORMANCE, // isolate performance's influence
  seed: "momentum-retirement-verification",
  now: new Date("2026-07-27T00:00:00.000Z"),
});

const byId = new Map(scores.map((score) => [score.productId, score]));
const thinHistory = byId.get("gid://shopify/Product/1")!;
const richHistory = byId.get("gid://shopify/Product/2")!;
const spread = byId.get("gid://shopify/Product/3")!;

console.log("Performance scores:", {
  thinHistory: thinHistory.performance,
  richHistory: richHistory.performance,
  spread: spread.performance,
});
console.log("Performance breakdowns:", {
  thinHistory: thinHistory.breakdown.performance,
  richHistory: richHistory.breakdown.performance,
  spread: spread.breakdown.performance,
});

// 1. Identical unitsSold/revenue must produce an IDENTICAL performance
// score regardless of how wildly the old momentum/sell-through inputs
// differ - proving those fields no longer feed the formula at all.
assert.equal(
  thinHistory.performance,
  richHistory.performance,
  "Two products with identical units sold and revenue must score identically on Performance, regardless of prior-window/inventory data"
);

// 2. The breakdown only exposes the two sub-metrics that still matter, at
// the documented 60/40 split.
assert.deepEqual(
  Object.keys(thinHistory.breakdown.performance).sort(),
  ["revenueRank", "revenueWeight", "unitsRank", "unitsWeight"],
  "Performance breakdown should only contain units and revenue fields now"
);
assert.equal(thinHistory.breakdown.performance.unitsWeight, 60);
assert.equal(thinHistory.breakdown.performance.revenueWeight, 40);

// 3. Performance is exactly the documented 60/40 blend of the two ranks.
for (const score of [thinHistory, richHistory, spread]) {
  const expected =
    score.breakdown.performance.unitsRank * 0.6 +
    score.breakdown.performance.revenueRank * 0.4;
  assert.ok(
    Math.abs(score.performance - expected) < 1e-9,
    `Performance should equal unitsRank*0.6 + revenueRank*0.4 for ${score.productId}`
  );
}

// 4. A genuinely lower-selling, lower-revenue product should still score
// lower on Performance than the higher-volume ones - the core signal still
// works with just these two inputs.
assert.ok(
  spread.performance < thinHistory.performance,
  "The lower units/revenue product should score lower on Performance"
);

console.log("Momentum retirement / performance simplification verification passed.");
