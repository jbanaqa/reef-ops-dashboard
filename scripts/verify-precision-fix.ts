import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// This script originally reproduced a Momentum/Sell-Through confidence-
// scaling bug (hence the filename) where a thin-volume product tied for 2nd
// out of 5 purely because tiny absolute numbers maxed out those two
// sub-metrics' percentiles. Momentum and Sell-Through have since been
// retired from Performance entirely (deemed unreliable in practice), so
// that specific bug can no longer occur - there's nothing left for a small
// batch to max out on. This script now verifies the simplified formula still
// produces a sensible, monotonic ordering from just Units Sold + Revenue.

const products = [
  { id: "A", legacyResourceId: "A", title: "6-total-units product", createdAt: new Date("2026-01-01") },
  { id: "B", legacyResourceId: "B", title: "Genuine bestseller", createdAt: new Date("2026-01-01") },
  { id: "C", legacyResourceId: "C", title: "Solid, flat seller", createdAt: new Date("2026-01-01") },
  { id: "D", legacyResourceId: "D", title: "Weak/slow mover", createdAt: new Date("2026-01-01") },
  { id: "E", legacyResourceId: "E", title: "Moderate, mildly accelerating seller", createdAt: new Date("2026-01-01") },
];

const base = (overrides: any) => ({
  productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
  priorUnitsSold: 0, hasPriorWindowData: false,
  currentWindowCoverage: 1, priorWindowCoverage: 1, hasCoverageData: false,
  availableInventory: 0, hasInventoryData: false, unexplainedShrinkage: 0,
  sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
  ...overrides,
});

const metrics = new Map([
  ["A", base({ productId: "A", purchases: 5, unitsSold: 5, revenue: 125 })],
  ["B", base({ productId: "B", purchases: 40, unitsSold: 40, revenue: 1000 })],
  ["C", base({ productId: "C", purchases: 20, unitsSold: 20, revenue: 500 })],
  ["D", base({ productId: "D", purchases: 2, unitsSold: 2, revenue: 50 })],
  ["E", base({ productId: "E", purchases: 10, unitsSold: 10, revenue: 250 })],
]);

const scores = scoreProducts({
  products,
  metrics,
  runOrders: [],
  weights: STRATEGY_PRESETS.PERFORMANCE, // isolate performance's influence
  seed: "precision-fix-verification",
  now: new Date("2026-07-28T00:00:00.000Z"),
});

const byTitle = new Map(scores.map((s) => [s.title, s]));
const bestseller = byTitle.get("Genuine bestseller")!;
const flatSeller = byTitle.get("Solid, flat seller")!;
const moderate = byTitle.get("Moderate, mildly accelerating seller")!;
const thinBatch = byTitle.get("6-total-units product")!;
const weakMover = byTitle.get("Weak/slow mover")!;

console.log(
  scores.map((s) => ({
    title: s.title,
    proposedPosition: s.proposedPosition,
    performance: s.performance.toFixed(1),
    unitsRank: s.breakdown.performance.unitsRank.toFixed(1),
    revenueRank: s.breakdown.performance.revenueRank.toFixed(1),
  }))
);

// Ordering should follow units sold (and, here, proportionally, revenue)
// exactly: bestseller > flatSeller > moderate > thinBatch > weakMover.
assert.deepEqual(
  scores.map((s) => s.title),
  [
    "Genuine bestseller",
    "Solid, flat seller",
    "Moderate, mildly accelerating seller",
    "6-total-units product",
    "Weak/slow mover",
  ],
  "Performance ordering should follow units sold / revenue directly, with no small-batch distortion"
);

assert.ok(
  flatSeller.proposedPosition < thinBatch.proposedPosition,
  "The flat 20-unit seller should outrank the 5-unit product"
);
assert.ok(
  moderate.proposedPosition < thinBatch.proposedPosition,
  "The 10-unit product should outrank the 5-unit product"
);

// The breakdown should only ever expose the two remaining sub-metrics.
for (const score of scores) {
  assert.deepEqual(
    Object.keys(score.breakdown.performance).sort(),
    ["revenueRank", "revenueWeight", "unitsRank", "unitsWeight"],
    `Performance breakdown for ${score.title} should only contain units and revenue fields`
  );
}

console.log("Precision-fix / performance simplification verification passed.");
