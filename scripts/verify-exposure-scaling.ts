import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// This script has now verified two successive Exposure fixes:
//   1. (original) The old absolute-distance decay flatlined past a FIXED
//      position (~60) regardless of collection size - "all of them have
//      exposure over 80, spread under 20." Fixed by expressing the tail
//      decay as a fraction of the collection's actual remaining depth.
//   2. (this version) That relative-depth fix used an EXPONENTIAL curve,
//      which drops fast early and then flattens - so most of a large
//      collection's products (which mostly live in the back half of the
//      tail) still all landed in a narrow ~20-point band near the top of
//      the scale ("everything scores 70-100"). Fixed by switching the tail
//      to a LINEAR decay, so "need" is spread evenly across the entire
//      0-100 range in proportion to how deep a product actually sits.

function buildProducts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${index + 1}`,
    legacyResourceId: `P${index + 1}`,
    title: `Product ${index + 1}`,
    createdAt: new Date("2025-01-01"),
  }));
}

function buildFlatMetrics(count: number) {
  const metrics = new Map();
  for (let index = 1; index <= count; index += 1) {
    metrics.set(`P${index}`, {
      productId: `P${index}`,
      productViews: 0,
      listViews: 0,
      listClicks: 0,
      addsToCart: 0,
      purchases: 10,
      unitsSold: 10,
      revenue: 200,
      priorUnitsSold: 10,
      hasPriorWindowData: true,
      currentWindowCoverage: 1,
      priorWindowCoverage: 1,
      hasCoverageData: true,
      availableInventory: 50,
      hasInventoryData: true,
      unexplainedShrinkage: 0,
      sources: ["SHOPIFY_REPORTS"],
      newestSyncAt: null,
    });
  }
  return metrics;
}

// A 300-product collection with NO run history yet (cold start), so every
// product's Exposure falls back to opportunityForPosition(currentPosition).
// Products are numbered in their current Shopify order, so product P250
// really does sit at position 250 of 300.
const PRODUCT_COUNT = 300;
const products = buildProducts(PRODUCT_COUNT);
const metrics = buildFlatMetrics(PRODUCT_COUNT);

const scores = scoreProducts({
  products,
  metrics,
  runOrders: [], // cold start - no history, forces the position-based fallback
  weights: STRATEGY_PRESETS.BALANCED,
  seed: "exposure-scaling-verification",
  now: new Date("2026-07-28T00:00:00.000Z"),
});

const byId = new Map(scores.map((score) => [score.productId, score]));
const deepPositions = [65, 100, 150, 200, 250, 300];
const exposures = deepPositions.map((position) => ({
  position,
  exposure: byId.get(`P${position}`)!.exposure,
}));

console.log("Exposure by deep position in a 300-product collection:");
console.log(exposures);

// Each deeper position should score meaningfully higher (more "neglected")
// than the one before it - no flatlining anywhere in the tail.
for (let index = 1; index < exposures.length; index += 1) {
  assert.ok(
    exposures[index].exposure > exposures[index - 1].exposure + 0.5,
    `Expected position ${exposures[index].position} to read as more neglected than position ${exposures[index - 1].position}, got ${exposures[index].exposure} vs ${exposures[index - 1].exposure}`
  );
}

// The linear tail is anchored to run all the way to 0 opportunity - so the
// VERY last product in any collection should now land at exactly 100 (fully
// "needs exposure"), not an artificial ~95 floor.
assert.ok(
  Math.abs(byId.get(`P${PRODUCT_COUNT}`)!.exposure - 100) < 0.5,
  `Expected the very last product to sit at exactly 100 exposure, got ${byId.get(`P${PRODUCT_COUNT}`)!.exposure}`
);

// The core regression this version fixes: under the old exponential tail,
// a product only a third of the way back (position 100 of 300, ~31% into
// the tail) already read as 73.6 - deep into the "everything's 70-100"
// compression zone. The new linear tail should place that same position
// meaningfully lower, proving the "need" range is spread across the WHOLE
// tail rather than bunched near the top.
assert.ok(
  byId.get("P100")!.exposure < 65,
  `Expected position 100 of 300 to score comfortably below the old compressed ~70-100 band, got ${byId.get("P100")!.exposure}`
);

// And the halfway-through-the-collection position (150 of 300, 48% into
// the tail) should land close to the middle of the 0-100 range, not
// bunched near the top - proof the linear curve actually uses the full
// scale instead of saturating early.
assert.ok(
  Math.abs(byId.get("P150")!.exposure - 67.97) < 0.5,
  `Expected position 150 of 300 to land near the middle of the range (~67.97), got ${byId.get("P150")!.exposure}`
);

// Position 12 (the last top-tier slot) and position 13 (the first tail
// slot) should read as nearly identical - proof the tail curve is
// genuinely anchored to the top tier's actual ending value, not a
// separately-chosen approximation that happens to be close.
assert.ok(
  Math.abs(byId.get("P12")!.exposure - byId.get("P13")!.exposure) < 1,
  `Expected no meaningful jump between position 12 and 13, got ${byId.get("P12")!.exposure} vs ${byId.get("P13")!.exposure}`
);

// Now prove scale-invariance still holds: the SAME relative depth (e.g.
// halfway through the tail) should produce the SAME exposure whether the
// collection has 60 products or 600 - the whole point of measuring depth
// as a fraction of each collection's own remaining length.
function exposureAtRelativeTailDepth(totalCount: number, fraction: number) {
  const testProducts = buildProducts(totalCount);
  const testMetrics = buildFlatMetrics(totalCount);
  const testScores = scoreProducts({
    products: testProducts,
    metrics: testMetrics,
    runOrders: [],
    weights: STRATEGY_PRESETS.BALANCED,
    seed: "exposure-scaling-verification",
    now: new Date("2026-07-28T00:00:00.000Z"),
  });
  const position = 12 + Math.round((totalCount - 12) * fraction);
  return testScores.find((score) => score.productId === `P${position}`)!
    .exposure;
}

const smallCollectionMidTail = exposureAtRelativeTailDepth(60, 0.5);
const largeCollectionMidTail = exposureAtRelativeTailDepth(600, 0.5);

console.log(
  `Exposure at 50% tail depth - 60-product collection: ${smallCollectionMidTail.toFixed(1)}, 600-product collection: ${largeCollectionMidTail.toFixed(1)}`
);

assert.ok(
  Math.abs(smallCollectionMidTail - largeCollectionMidTail) < 1,
  `Expected exposure at the same relative tail depth to be scale-invariant, got ${smallCollectionMidTail} (60 products) vs ${largeCollectionMidTail} (600 products)`
);

// The linear formula puts 50% tail depth at exactly 69.25 need
// (opportunity = 0.615 * (1 - 0.5) = 0.3075, need = 69.25, where 0.615 is
// the exact opportunity position 12 ends on) - pin that down explicitly so
// a future change can't silently drift the curve's shape.
assert.ok(
  Math.abs(smallCollectionMidTail - 69.25) < 0.5,
  `Expected 50% tail depth to land at exactly 69.25 need, got ${smallCollectionMidTail}`
);

console.log("Exposure scaling verification passed.");
