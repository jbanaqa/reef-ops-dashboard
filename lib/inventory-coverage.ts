// Reconstructs, from the InventoryEvent history we already record, roughly
// how much of a given date window a product actually had stock on hand.
// This exists specifically so Sales Momentum can tell "genuine demand
// acceleration" apart from "this product just happened to get restocked
// near a window boundary" - a distinction raw unit counts alone can't make,
// since two windows of equal calendar length aren't a fair comparison if the
// product was only sellable for a fraction of one of them. That situation is
// the rule rather than the exception here, since livestock/coral restocking
// is driven by supplier availability rather than a predictable schedule.
export type InventoryChangeEvent = {
  detectedAt: Date;
  netDelta: number;
  // The location-level stock count immediately before this change (already
  // recorded on every InventoryEvent row). Used only for the earliest event
  // in range, to tell a genuine "this arrived from zero stock" restock apart
  // from "our event history simply doesn't reach back any further than this."
  startingAvailable: number;
};

export type WindowCoverage = {
  // 0-1: fraction of the window's duration this product had available > 0.
  coverage: number;
  // True if at least one inventory event actually informed this number,
  // rather than the number being a pure "we have no history, assume it was
  // available the whole time" default.
  hasCoverageData: boolean;
};

/**
 * Reconstructs a piecewise-constant "units available" timeline by walking
 * backward from the current known stock level (InventorySnapshot), undoing
 * each recorded change (InventoryEvent.netDelta) in reverse chronological
 * order, then measures what fraction of [windowStart, windowEnd) had a
 * positive level.
 *
 * Anything before the earliest event we can see is treated as available by
 * default (so a plain gap in tracked history never reads as a stockout) -
 * UNLESS that earliest event's own startingAvailable was 0, which is direct
 * evidence the product genuinely had no stock immediately before it (a real
 * "just arrived" restock, not a tracking gap).
 */
export function computeWindowCoverage(input: {
  events: InventoryChangeEvent[];
  currentAvailable: number;
  windowStart: Date;
  windowEnd: Date;
  now: Date;
}): WindowCoverage {
  const windowStartMs = input.windowStart.getTime();
  const windowEndMs = input.windowEnd.getTime();
  const totalMs = Math.max(1, windowEndMs - windowStartMs);
  const sortedDesc = [...input.events].sort(
    (a, b) => b.detectedAt.getTime() - a.detectedAt.getTime()
  );

  let runningTotal = input.currentAvailable;
  let cursor = input.now.getTime();
  let availableMs = 0;
  let earliestProcessedStartingAvailable: number | null = null;
  let processedAny = false;

  for (const event of sortedDesc) {
    const eventMs = event.detectedAt.getTime();
    if (eventMs >= cursor) continue; // ignore out-of-order/duplicate timestamps

    const overlapStart = Math.max(eventMs, windowStartMs);
    const overlapEnd = Math.min(cursor, windowEndMs);
    if (overlapEnd > overlapStart && runningTotal > 0) {
      availableMs += overlapEnd - overlapStart;
    }

    runningTotal -= event.netDelta;
    cursor = eventMs;
    earliestProcessedStartingAvailable = event.startingAvailable;
    processedAny = true;
  }

  const unknownEraStart = windowStartMs;
  const unknownEraEnd = Math.min(cursor, windowEndMs);
  const knownZeroBeforeEarliest =
    processedAny && earliestProcessedStartingAvailable === 0;

  if (unknownEraEnd > unknownEraStart && !knownZeroBeforeEarliest) {
    availableMs += unknownEraEnd - unknownEraStart;
  }

  const hasCoverageData = input.events.some(
    (event) => event.detectedAt.getTime() <= windowEndMs
  );

  return {
    coverage: Math.min(1, Math.max(0, availableMs / totalMs)),
    hasCoverageData,
  };
}
