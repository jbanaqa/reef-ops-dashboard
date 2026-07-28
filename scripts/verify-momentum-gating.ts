import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// End-to-end proof, against the real scoring code (not a standalone
// reproduction), that:
//   1. A product restocked from zero right at the prior-window boundary no
//      longer wins on momentum just because of that timing artifact.
//   2. A genuinely, reliably accelerating product still wins.
//   3. A rare, thin-history product (tiny coverage + tiny volume) is gated
//      to neutral rather than producing a huge/noisy ratio.

const products = [
  { id: "gid://shopify/Product/1", legacyResourceId: "1", title: "Restocked-at-boundary item", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/2", legacyResourceId: "2", title: "Reliable accelerating bestseller", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/3", legacyResourceId: "3", title: "Flat, always in stock", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/4", legacyResourceId: "4", title: "Rare specimen, sold same day it arrived", createdAt: new Date("2026-01-01") },
  { id: "gid://shopify/Product/5", legacyResourceId: "5", title: "Just-cleared-the-gate, thin volume", createdAt: new Date("2026-01-01") },
];

const metrics = new Map([
  [
    "1",
    {
      productId: "1",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 4, unitsSold: 4, revenue: 100,
      priorUnitsSold: 1, hasPriorWindowData: true,
      currentWindowCoverage: 1, priorWindowCoverage: 10 / 90, hasCoverageData: true,
      availableInventory: 5, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "2",
    {
      productId: "2",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 15, unitsSold: 15, revenue: 375,
      priorUnitsSold: 12, hasPriorWindowData: true,
      currentWindowCoverage: 1, priorWindowCoverage: 1, hasCoverageData: true,
      availableInventory: 20, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "3",
    {
      productId: "3",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 6, unitsSold: 6, revenue: 150,
      priorUnitsSold: 6, hasPriorWindowData: true,
      currentWindowCoverage: 1, priorWindowCoverage: 1, hasCoverageData: true,
      availableInventory: 24, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "4",
    {
      productId: "4",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 1, unitsSold: 1, revenue: 40,
      priorUnitsSold: 0, hasPriorWindowData: true,
      currentWindowCoverage: 1 / 90, priorWindowCoverage: 1, hasCoverageData: true,
      availableInventory: 0, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
  [
    "5",
    {
      // Eligible (good coverage both windows) but has JUST barely cleared
      // the minimum-combined-units floor (6 > 4) - should land close to
      // neutral, not get full credit for its 1.87-ish raw ratio, since
      // MOMENTUM_FULL_CONFIDENCE_UNITS is 20.
      productId: "5",
      productViews: 0, listViews: 0, listClicks: 0, addsToCart: 0,
      purchases: 5, unitsSold: 5, revenue: 125,
      priorUnitsSold: 1, hasPriorWindowData: true,
      currentWindowCoverage: 1, priorWindowCoverage: 0.778, hasCoverageData: true,
      availableInventory: 4, hasInventoryData: true, unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"], newestSyncAt: null,
    },
  ],
]);

const scores = scoreProducts({
  products,
  metrics,
  runOrders: [],
  weights: STRATEGY_PRESETS.PERFORMANCE, // isolate performance's influence, matching how this was actually caught
  seed: "momentum-gating-verification",
  now: new Date("2026-07-27T00:00:00.000Z"),
});

const byId = new Map(scores.map((score) => [score.productId, score]));
const restocked = byId.get("gid://shopify/Product/1")!;
const reliable = byId.get("gid://shopify/Product/2")!;
const flat = byId.get("gid://shopify/Product/3")!;
const rareSpecimen = byId.get("gid://shopify/Product/4")!;
const thinVolume = byId.get("gid://shopify/Product/5")!;

console.log("Momentum ranks:", {
  restockedAtBoundary: restocked.breakdown.performance.momentumRank,
  reliableAccelerating: reliable.breakdown.performance.momentumRank,
  flat: flat.breakdown.performance.momentumRank,
  rareSpecimen: rareSpecimen.breakdown.performance.momentumRank,
  thinVolume: thinVolume.breakdown.performance.momentumRank,
});
console.log("momentumEligible / momentumConfidence:", {
  restockedAtBoundary: [restocked.breakdown.performance.momentumEligible, restocked.breakdown.performance.momentumConfidence],
  reliableAccelerating: [reliable.breakdown.performance.momentumEligible, reliable.breakdown.performance.momentumConfidence],
  flat: [flat.breakdown.performance.momentumEligible, flat.breakdown.performance.momentumConfidence],
  rareSpecimen: [rareSpecimen.breakdown.performance.momentumEligible, rareSpecimen.breakdown.performance.momentumConfidence],
  thinVolume: [thinVolume.breakdown.performance.momentumEligible, thinVolume.breakdown.performance.momentumConfidence],
});

// 1. The restock-at-boundary item must NOT be eligible - its prior window
// coverage (11%) is below the 50% bar.
assert.equal(
  restocked.breakdown.performance.momentumEligible,
  false,
  "Restock-at-boundary item's momentum should be ineligible (low prior-window coverage)"
);

// 2. The reliable, consistently-stocked accelerating product SHOULD be
// eligible with full confidence (75 combined units, well past the
// full-confidence floor), and should rank the highest on momentum of all
// five - specifically higher than the restocked item, which is the exact
// ordering bug this fix was built to correct.
assert.equal(
  reliable.breakdown.performance.momentumEligible,
  true,
  "Reliably-stocked accelerating product's momentum should be eligible"
);
assert.equal(
  reliable.breakdown.performance.momentumConfidence,
  1,
  "75 combined units is well past the full-confidence floor"
);
assert.ok(
  reliable.breakdown.performance.momentumRank > restocked.breakdown.performance.momentumRank,
  "The genuinely reliable accelerator must outrank the restock-timing artifact on momentum"
);

// 3. The rare, thin-history specimen must also be ineligible (tiny coverage)
// rather than reading as a huge spike.
assert.equal(
  rareSpecimen.breakdown.performance.momentumEligible,
  false,
  "Rare thin-history specimen's momentum should be ineligible"
);
assert.ok(
  rareSpecimen.breakdown.performance.momentumRank <= reliable.breakdown.performance.momentumRank,
  "The rare thin-history specimen must not outrank the genuinely reliable accelerator on momentum"
);

// 4. Ineligible products should land at the same neutral rank as the
// genuinely flat product (all "flat" from momentum's point of view, for
// different reasons).
assert.equal(
  restocked.breakdown.performance.momentumRank,
  flat.breakdown.performance.momentumRank,
  "An ineligible momentum ratio should read identically to a genuinely flat one"
);

// 5. The just-cleared-the-gate product (6 combined units, eligible, real
// 1.87-ish ratio) should have LOW confidence and land well below the fully-
// trusted reliable accelerator - this is the exact scenario found in
// production (a product with barely enough volume to pass the old binary
// gate getting full credit for a dramatic ratio).
assert.ok(
  thinVolume.breakdown.performance.momentumConfidence > 0 &&
    thinVolume.breakdown.performance.momentumConfidence < 0.3,
  `Thin-volume-but-eligible product should have low (not zero, not full) confidence, got ${thinVolume.breakdown.performance.momentumConfidence}`
);
assert.ok(
  thinVolume.breakdown.performance.momentumRank < reliable.breakdown.performance.momentumRank,
  "A thin-volume product should not outrank the fully-trusted reliable accelerator on momentum, even with a higher raw ratio"
);

console.log("Momentum gating verification passed.");
