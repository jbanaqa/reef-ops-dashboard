import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// Reproduces the exact scenario that prompted the Momentum/Sell-Through
// confidence-scaling fix: a product that's only sold 6 total units across
// 180 days (5 now, 1 prior, thin remaining stock) was tying for 2nd place
// out of 5 - ahead of a genuinely-selling-20-units-flat product - purely
// because Momentum AND Sell-Through both maxed out at the 100th percentile
// off tiny absolute numbers. This proves that no longer happens.

const products = [
  { id: "A", legacyResourceId: "A", title: "6-total-units product", createdAt: new Date("2026-01-01") },
  { id: "B", legacyResourceId: "B", title: "Genuine bestseller", createdAt: new Date("2026-01-01") },
  { id: "C", legacyResourceId: "C", title: "Solid, flat seller", createdAt: new Date("2026-01-01") },
  { id: "D", legacyResourceId: "D", title: "Weak/slow mover", createdAt: new Date("2026-01-01") },
  { id: "E", legacyResourceId: "E", title: "Moderate, mildly accelerating seller", createdAt: new Date("2026-01-01") },
];

const base = (overrides: any) => ({
  productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
  hasPriorWindowData: true, hasInventoryData: true, unexplainedShrinkage: 0,
  sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
  ...overrides,
});

const metrics = new Map([
  ["A", base({ productId: "A", purchases: 5, unitsSold: 5, revenue: 125, priorUnitsSold: 1, currentWindowCoverage: 1, priorWindowCoverage: 0.778, availableInventory: 4 })],
  ["B", base({ productId: "B", purchases: 40, unitsSold: 40, revenue: 1000, priorUnitsSold: 35, currentWindowCoverage: 1, priorWindowCoverage: 1, availableInventory: 100 })],
  ["C", base({ productId: "C", purchases: 20, unitsSold: 20, revenue: 500, priorUnitsSold: 20, currentWindowCoverage: 1, priorWindowCoverage: 1, availableInventory: 50 })],
  ["D", base({ productId: "D", purchases: 2, unitsSold: 2, revenue: 50, priorUnitsSold: 2, currentWindowCoverage: 1, priorWindowCoverage: 1, availableInventory: 30 })],
  ["E", base({ productId: "E", purchases: 10, unitsSold: 10, revenue: 250, priorUnitsSold: 8, currentWindowCoverage: 1, priorWindowCoverage: 1, availableInventory: 15 })],
]);

const scores = scoreProducts({
  products,
  metrics,
  runOrders: [],
  weights: STRATEGY_PRESETS.PERFORMANCE,
  seed: "precision-fix-verification",
  now: new Date("2026-07-28T00:00:00.000Z"),
});

const byTitle = new Map(scores.map((s) => [s.title, s]));
const thinBatch = byTitle.get("6-total-units product")!;
const flatSeller = byTitle.get("Solid, flat seller")!;
const moderateAccelerating = byTitle.get("Moderate, mildly accelerating seller")!;

console.log(
  scores.map((s) => ({
    title: s.title,
    proposedPosition: s.proposedPosition,
    performance: s.performance.toFixed(1),
    momentumConfidence: s.breakdown.performance.momentumConfidence.toFixed(2),
    sellThroughConfidence: s.breakdown.performance.sellThroughConfidence.toFixed(2),
  }))
);

// The thin-batch product must no longer outrank the genuinely-higher-volume
// flat seller - this was the core complaint.
assert.ok(
  flatSeller.proposedPosition < thinBatch.proposedPosition,
  `Expected the flat 20-unit seller to outrank the 6-total-unit product, got positions ${flatSeller.proposedPosition} vs ${thinBatch.proposedPosition}`
);

// The genuinely moderate, real-volume accelerating product should still beat
// the thin-batch product too, since its trend is backed by real volume.
assert.ok(
  moderateAccelerating.proposedPosition < thinBatch.proposedPosition,
  "The moderate but real-volume accelerating product should still outrank the thin-batch product"
);

// Confirm the mechanism: both confidences should be low (not zero, not
// full) for the thin-batch product.
assert.ok(
  thinBatch.breakdown.performance.momentumConfidence < 0.3,
  `Expected low momentum confidence for the thin-batch product, got ${thinBatch.breakdown.performance.momentumConfidence}`
);
assert.ok(
  thinBatch.breakdown.performance.sellThroughConfidence < 0.4,
  `Expected low sell-through confidence for the thin-batch product, got ${thinBatch.breakdown.performance.sellThroughConfidence}`
);

console.log("Precision-fix verification passed.");
