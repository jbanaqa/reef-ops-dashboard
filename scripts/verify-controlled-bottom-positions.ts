import assert from "node:assert/strict";

// applyControlledPositions() in lib/collection-rotation-plan.ts isn't
// exported (it's an internal helper the async, DB-backed
// buildCollectionRotationPlan() calls), so - same approach as the other
// verify-*.ts scripts in this folder take for logic that can't be invoked
// directly against a real database - this mirrors its exact placement
// algorithm as a standalone pure function and exercises it directly.
//
// Covers the new "pin to bottom" zone on top of the pre-existing "pin to
// top" behavior: bottom assignments counting up from the end of the
// collection, top and bottom zones never overlapping even if requested
// counts together exceed the collection size, and a product that (invalidly,
// since the unique DB constraint prevents this in practice) appears in both
// a top and a bottom rule always resolving to its top placement.

type ControlledRule = {
  shopifyProductId: string;
  position: number;
  zone: "TOP" | "BOTTOM";
};

type Rotation = {
  controlledTopCount: number;
  controlledBottomCount: number;
  controlledProducts: ControlledRule[];
};

function applyControlledPositions(
  productIds: string[],
  rankedProductIds: string[],
  rotation: Rotation
) {
  const controlledTopCount = Math.min(
    Math.max(0, rotation.controlledTopCount),
    productIds.length
  );
  const controlledBottomCount = Math.min(
    Math.max(0, rotation.controlledBottomCount),
    productIds.length - controlledTopCount
  );
  const validIds = new Set(productIds);
  const usedIds = new Set<string>();

  function collectAssignments(zone: "TOP" | "BOTTOM", zoneCount: number) {
    return rotation.controlledProducts
      .filter(
        (rule) =>
          rule.zone === zone &&
          rule.position >= 1 &&
          rule.position <= zoneCount &&
          validIds.has(rule.shopifyProductId) &&
          !usedIds.has(rule.shopifyProductId)
      )
      .filter((rule) => {
        usedIds.add(rule.shopifyProductId);
        return true;
      });
  }

  const topAssignments = collectAssignments("TOP", controlledTopCount);
  const bottomAssignments = collectAssignments("BOTTOM", controlledBottomCount);

  const remaining = rankedProductIds.filter((productId) => !usedIds.has(productId));
  const target = new Array<string | null>(productIds.length).fill(null);

  for (const assignment of topAssignments) {
    target[assignment.position - 1] = assignment.shopifyProductId;
  }

  for (const assignment of bottomAssignments) {
    target[target.length - assignment.position] = assignment.shopifyProductId;
  }

  let remainingIndex = 0;

  for (let index = 0; index < target.length; index += 1) {
    if (!target[index]) {
      target[index] = remaining[remainingIndex] ?? null;
      remainingIndex += 1;
    }
  }

  return target.filter((value): value is string => Boolean(value));
}

function buildIds(count: number) {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

// --- Test 1: bottom-only pin, small collection --------------------------
{
  const productIds = buildIds(10);
  const ranked = [...productIds]; // pretend scoring left them in original order

  const result = applyControlledPositions(productIds, ranked, {
    controlledTopCount: 0,
    controlledBottomCount: 2,
    controlledProducts: [
      { shopifyProductId: "P5", position: 1, zone: "BOTTOM" }, // last slot
      { shopifyProductId: "P1", position: 2, zone: "BOTTOM" }, // second-to-last slot
    ],
  });

  assert.equal(result.length, 10, "Every product should still be placed");
  assert.equal(result[9], "P5", "Bottom position 1 should land in the very last slot");
  assert.equal(result[8], "P1", "Bottom position 2 should land in the second-to-last slot");
  assert.ok(
    !result.slice(0, 8).includes("P5") && !result.slice(0, 8).includes("P1"),
    "Pinned bottom products shouldn't also appear earlier in the order"
  );

  console.log("Test 1 (bottom-only pin) passed:", result);
}

// --- Test 2: top AND bottom pins coexist without touching each other ----
{
  const productIds = buildIds(10);
  const ranked = [...productIds];

  const result = applyControlledPositions(productIds, ranked, {
    controlledTopCount: 2,
    controlledBottomCount: 2,
    controlledProducts: [
      { shopifyProductId: "P9", position: 1, zone: "TOP" },
      { shopifyProductId: "P8", position: 2, zone: "TOP" },
      { shopifyProductId: "P2", position: 1, zone: "BOTTOM" },
      { shopifyProductId: "P3", position: 2, zone: "BOTTOM" },
    ],
  });

  assert.equal(result[0], "P9", "Top position 1 should be honored");
  assert.equal(result[1], "P8", "Top position 2 should be honored");
  assert.equal(result[9], "P2", "Bottom position 1 should be honored");
  assert.equal(result[8], "P3", "Bottom position 2 should be honored");

  console.log("Test 2 (top + bottom coexist) passed:", result);
}

// --- Test 3: requested top+bottom counts exceed collection size - bottom
// clamps down to whatever room the top zone hasn't claimed, so the two
// zones can never overlap in the middle. -------------------------------
{
  const productIds = buildIds(5);
  const ranked = [...productIds];

  // Top claims 4 of 5 slots; bottom asks for 4 but only 1 slot is left.
  const result = applyControlledPositions(productIds, ranked, {
    controlledTopCount: 4,
    controlledBottomCount: 4,
    controlledProducts: [
      { shopifyProductId: "P1", position: 1, zone: "TOP" },
      { shopifyProductId: "P2", position: 2, zone: "TOP" },
      { shopifyProductId: "P3", position: 3, zone: "TOP" },
      { shopifyProductId: "P4", position: 4, zone: "TOP" },
      // Only bottom position 1 can possibly fit in the one remaining slot -
      // positions 2-4 are outside the clamped range and should be dropped.
      { shopifyProductId: "P5", position: 1, zone: "BOTTOM" },
      { shopifyProductId: "P1", position: 2, zone: "BOTTOM" }, // already used by TOP anyway
    ],
  });

  assert.deepEqual(
    result,
    ["P1", "P2", "P3", "P4", "P5"],
    "Bottom zone should clamp to the single slot the top zone left available"
  );

  console.log("Test 3 (zone overlap clamping) passed:", result);
}

// --- Test 4: a product invalidly referenced by both a top and bottom rule
// (can't really happen given the DB's unique-per-product constraint, but
// the algorithm should still degrade predictably) resolves to its TOP
// placement, since top assignments are collected first. -----------------
{
  const productIds = buildIds(6);
  const ranked = [...productIds];

  const result = applyControlledPositions(productIds, ranked, {
    controlledTopCount: 1,
    controlledBottomCount: 1,
    controlledProducts: [
      { shopifyProductId: "P3", position: 1, zone: "TOP" },
      { shopifyProductId: "P3", position: 1, zone: "BOTTOM" }, // same product, both zones
    ],
  });

  assert.equal(result[0], "P3", "The product should win its TOP placement");
  assert.notEqual(
    result[result.length - 1],
    "P3",
    "The product should not also be placed at the bottom"
  );

  console.log("Test 4 (product claimed by both zones) passed:", result);
}

// --- Test 5: scale sanity - bottom position 1 is always the true last
// index regardless of collection size. -----------------------------------
{
  for (const size of [3, 50, 301]) {
    const productIds = buildIds(size);
    const ranked = [...productIds];

    const result = applyControlledPositions(productIds, ranked, {
      controlledTopCount: 0,
      controlledBottomCount: 1,
      controlledProducts: [
        { shopifyProductId: "P2", position: 1, zone: "BOTTOM" },
      ],
    });

    assert.equal(
      result[result.length - 1],
      "P2",
      `Bottom position 1 should be the true last slot for a ${size}-product collection`
    );
  }

  console.log("Test 5 (scale sanity) passed.");
}

console.log("Controlled bottom-position verification passed.");
