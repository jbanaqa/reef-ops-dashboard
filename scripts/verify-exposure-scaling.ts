import assert from "node:assert/strict";

import { scoreProducts, STRATEGY_PRESETS } from "../lib/collection-rotation-scoring";

// Reproduces the exact complaint: in a large collection, the old
// opportunityForPosition() curve decayed over a FIXED absolute distance
// (floor reached by ~position 60 regardless of collection size), so any
// product sitting deeper than that got an identical, maximally-pinned
// Exposure score with zero differentiation - "all of them have exposure
// over 80, spread under 20." This proves the new relative-depth curve
// produces a real, distinct gradient across the ENTIRE depth of a large
// collection instead of flatlining past a fixed absolute position.

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
// really does sit at position 250 of 300 - deep in what used to be the
// flatlined dead zone (anything past position ~60 used to be pinned at
// identical 95.0 exposure no matter how much deeper it went).
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

// The core bug: under the old fixed-distance decay, positions 65 through
// 300 were ALL pinned at exactly 95.0 - identical, no differentiation.
// Confirm that's no longer true: each deeper position should score
// meaningfully higher (more "neglected") than the one before it.
for (let index = 1; index < exposures.length; index += 1) {
  assert.ok(
    exposures[index].exposure > exposures[index - 1].exposure + 0.5,
    `Expected position ${exposures[index].position} to read as more neglected than position ${exposures[index - 1].position}, got ${exposures[index].exposure} vs ${exposures[index - 1].exposure}`
  );
}

// The very last product in the collection should still land at roughly the
// same ~95 "maximally neglected" ceiling the old curve used, just now
// reached proportionally at the true end of the collection instead of at a
// fixed absolute position.
assert.ok(
  Math.abs(byId.get(`P${PRODUCT_COUNT}`)!.exposure - 95) < 1,
  `Expected the very last product to sit near 95 exposure, got ${byId.get(`P${PRODUCT_COUNT}`)!.exposure}`
);

// Now prove scale-invariance: the SAME relative depth (e.g. halfway through
// the tail) should produce roughly the same exposure whether the collection
// has 60 products or 600 - the whole point of switching to a relative-depth
// curve instead of an absolute one.
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

console.log("Exposure scaling verification passed.");
