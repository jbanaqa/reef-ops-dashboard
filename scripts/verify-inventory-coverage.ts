import assert from "node:assert/strict";

import { computeWindowCoverage, type InventoryChangeEvent } from "../lib/inventory-coverage";

const DAY = 86_400_000;
const day = (n: number) => new Date(n * DAY);
const close = (actual: number, expected: number, tol = 0.01) =>
  Math.abs(actual - expected) <= tol;

// Genuine restock-from-zero mid prior-window (the real case this was built
// for): product had 0 stock, restocked (from 0) at day 80 of a 90-day
// window, sold a couple units since.
{
  const events: InventoryChangeEvent[] = [
    { detectedAt: day(80), netDelta: 10, startingAvailable: 0 },
    { detectedAt: day(85), netDelta: -1, startingAvailable: 10 },
    { detectedAt: day(88), netDelta: -1, startingAvailable: 9 },
  ];
  const result = computeWindowCoverage({
    events,
    currentAvailable: 8,
    windowStart: day(0),
    windowEnd: day(90),
    now: day(90),
  });
  assert.ok(
    close(result.coverage, 10 / 90),
    `Expected ~11% coverage for a late restock, got ${result.coverage}`
  );
  assert.equal(result.hasCoverageData, true);
}

// No inventory-event history at all: a pure data gap should default to
// "assume available," never a guessed stockout.
{
  const result = computeWindowCoverage({
    events: [],
    currentAvailable: 6,
    windowStart: day(0),
    windowEnd: day(90),
    now: day(95),
  });
  assert.ok(close(result.coverage, 1), "No history should default to full coverage");
  assert.equal(result.hasCoverageData, false);
}

// Tracking only started partway back (the earliest known event's
// startingAvailable is nonzero) - this is a tracking gap, not evidence of a
// stockout, so it should NOT be penalized the way scenario 1 is.
{
  const events: InventoryChangeEvent[] = [
    { detectedAt: day(20), netDelta: -2, startingAvailable: 12 },
  ];
  const result = computeWindowCoverage({
    events,
    currentAvailable: 10,
    windowStart: day(0),
    windowEnd: day(90),
    now: day(90),
  });
  assert.ok(
    close(result.coverage, 1),
    "A tracking gap (nonzero startingAvailable) should assume available, not penalize"
  );
}

// Fully available the whole window - an ordinary sale shouldn't create a gap.
{
  const events: InventoryChangeEvent[] = [
    { detectedAt: day(50), netDelta: -3, startingAvailable: 20 },
  ];
  const result = computeWindowCoverage({
    events,
    currentAvailable: 17,
    windowStart: day(0),
    windowEnd: day(90),
    now: day(90),
  });
  assert.ok(close(result.coverage, 1), "A normal sale shouldn't reduce coverage");
}

// Sold completely out partway through and stayed at 0.
{
  const events: InventoryChangeEvent[] = [
    { detectedAt: day(30), netDelta: -5, startingAvailable: 5 },
  ];
  const result = computeWindowCoverage({
    events,
    currentAvailable: 0,
    windowStart: day(0),
    windowEnd: day(90),
    now: day(90),
  });
  assert.ok(
    close(result.coverage, 30 / 90),
    `Expected ~33% coverage after selling out day 30, got ${result.coverage}`
  );
}

console.log("Inventory coverage verification passed.");
