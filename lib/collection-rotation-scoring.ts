export type RotationStrategy =
  | "BALANCED"
  | "PERFORMANCE"
  | "DISCOVERY"
  | "RANDOM"
  | "CUSTOM";

export type RotationWeights = {
  performance: number;
  exposure: number;
  freshness: number;
  exploration: number;
};

export type ScoringProduct = {
  id: string;
  legacyResourceId: string;
  title: string;
  createdAt: Date;
};

export type ProductMetric = {
  productId: string;
  // productViews/listViews/listClicks/addsToCart are GA4-sourced and, since
  // GA4 isn't connected, are always 0 right now. They're kept on this type
  // (rather than removed) so Performance scoring can start using them again
  // the moment a page-view source comes online, but they no longer feed the
  // Performance formula below - see the redesign notes on scoreProducts().
  productViews: number;
  listViews: number;
  listClicks: number;
  addsToCart: number;
  purchases: number;
  unitsSold: number;
  revenue: number;
  // Units sold in the equal-length window immediately before this one -
  // powers the Sales Momentum sub-metric. hasPriorWindowData is false until
  // a "Sync analytics" run has captured that prior window at least once.
  priorUnitsSold: number;
  hasPriorWindowData: boolean;
  // What fraction (0-1) of the current/prior lookback window this product
  // actually had stock on hand, reconstructed from InventoryEvent history.
  // Momentum only trusts the raw unit counts above once both windows clear
  // a minimum coverage bar - see MOMENTUM_MIN_WINDOW_COVERAGE below. A
  // product restocked right at a window boundary will show low coverage in
  // whichever window it mostly missed, which is exactly the signal needed
  // to stop that timing artifact from reading as real demand acceleration.
  currentWindowCoverage: number;
  priorWindowCoverage: number;
  hasCoverageData: boolean;
  // Current on-hand inventory (summed across locations) - powers the
  // Sell-Through Rate sub-metric. hasInventoryData is false if this product
  // has never had an inventory webhook recorded.
  availableInventory: number;
  hasInventoryData: boolean;
  // Units that disappeared from inventory during the lookback window with no
  // matching Shopify order behind them (from InventoryEvent.unknownChangeQuantity
  // - e.g. livestock deaths or other manual write-offs with no reason code
  // attached). Sell-Through adds this back into "available" so a die-off
  // doesn't get misread as a hot seller. 0 genuinely means "no untracked
  // loss found," not missing data, so this has no separate has*Data flag.
  unexplainedShrinkage: number;
  sources: string[];
  newestSyncAt: string | null;
};

export type ProductScoreBreakdown = {
  performance: {
    unitsRank: number;
    unitsWeight: number;
    revenueRank: number;
    revenueWeight: number;
    momentumRank: number;
    momentumWeight: number;
    priorUnitsSold: number;
    hasPriorWindowData: boolean;
    currentWindowCoverage: number;
    priorWindowCoverage: number;
    hasCoverageData: boolean;
    // Cleared the hard gates (prior data exists, both windows had enough
    // stock coverage) - a prerequisite for momentumConfidence to be above 0.
    momentumEligible: boolean;
    // 0-1: how much this product's combined sales volume (current + prior
    // window) supports trusting its momentum ratio, once eligible. Blends
    // toward neutral continuously rather than a hard pass/fail, so a product
    // that just barely clears the eligibility bar doesn't get full credit
    // for a ratio built from very few sales.
    momentumConfidence: number;
    sellThroughRank: number;
    sellThroughWeight: number;
    // 0-1: how much total transaction volume (units sold + effective
    // available) supports trusting this product's sell-through ratio. Same
    // purpose as momentumConfidence - a tiny batch can swing to a
    // dramatic-looking ratio off a single unit.
    sellThroughConfidence: number;
    availableInventory: number;
    hasInventoryData: boolean;
    unexplainedShrinkage: number;
    effectiveAvailable: number;
  };
  exposure: {
    appearedInRuns: number;
    totalRuns: number;
    averageOpportunityPercent: number;
    usedCurrentPositionFallback: boolean;
  };
  freshness: {
    ageDays: number;
    halfLifeDays: number;
  };
  exploration: {
    seed: string;
    productId: string;
  };
};

export type ProductScore = {
  productId: string;
  title: string;
  score: number;
  performance: number;
  exposure: number;
  freshness: number;
  exploration: number;
  ageDays: number;
  metrics: ProductMetric;
  breakdown: ProductScoreBreakdown;
  previousPosition: number;
  proposedPosition: number;
};

export const STRATEGY_PRESETS: Record<
  Exclude<RotationStrategy, "CUSTOM">,
  RotationWeights
> = {
  BALANCED: {
    performance: 45,
    exposure: 30,
    freshness: 15,
    exploration: 10,
  },
  PERFORMANCE: {
    performance: 65,
    exposure: 20,
    freshness: 5,
    exploration: 10,
  },
  DISCOVERY: {
    performance: 25,
    exposure: 40,
    freshness: 25,
    exploration: 10,
  },
  RANDOM: {
    performance: 0,
    exposure: 0,
    freshness: 0,
    exploration: 100,
  },
};

export const STRATEGY_LABELS: Record<RotationStrategy, string> = {
  BALANCED: "Balanced",
  PERFORMANCE: "Performance",
  DISCOVERY: "Discovery",
  RANDOM: "Pure random",
  CUSTOM: "Custom",
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(Math.max(value, minimum), maximum);
}

// Linearly ramps confidence from 0 (at or below `from`) to 1 (at or above
// `to`), used to fade a thin-data ratio toward neutral gradually rather than
// as a hard cliff at one specific sample size.
function confidenceRamp(value: number, from: number, to: number) {
  if (to <= from) return value >= to ? 1 : 0;
  return clamp((value - from) / (to - from), 0, 1);
}

export function normalizeWeights(weights: RotationWeights) {
  const sanitized = {
    performance: clamp(Math.round(weights.performance)),
    exposure: clamp(Math.round(weights.exposure)),
    freshness: clamp(Math.round(weights.freshness)),
    exploration: clamp(Math.round(weights.exploration)),
  };
  const total = Object.values(sanitized).reduce(
    (sum, value) => sum + value,
    0
  );

  if (total !== 100) {
    throw new Error("Rotation weights must add up to 100.");
  }

  return sanitized;
}

function hashUnit(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function percentileRanks(values: number[]) {
  if (values.length < 2) {
    return values.map(() => 50);
  }

  const sorted = [...values].sort((a, b) => a - b);

  return values.map((value) => {
    const first = sorted.indexOf(value);
    const last = sorted.lastIndexOf(value);
    const middle = (first + last) / 2;
    return (middle / (sorted.length - 1)) * 100;
  });
}

// The top 12 positions are a fixed concept regardless of collection size -
// they're literally what renders in the front-of-collection grid and
// featured sliders - so this tier keeps the same absolute curve it always
// had: 100% opportunity at position 1, decaying to ~61.5% at position 12.
//
// Past position 12 used to decay over a fixed absolute distance (a constant
// divisor of 20), which reaches its 5% floor by around position 60 no
// matter how big the collection is. In any collection bigger than that,
// most products end up tied at the exact same "maximally neglected" value -
// a product sitting at position 65 scores identically to one sitting at
// position 650, with zero ability to tell them apart. Expressing the
// post-12 decay as a fraction of the collection's ACTUAL remaining depth
// (0 just past the top 12, 1 at the very last product) fixes this: the
// decay always spans the collection's whole real tail, so there's a
// meaningful, continuous gradient all the way to the last slot no matter
// how many products the collection has.
const EXPOSURE_TAIL_DECAY_RATE = 2.4;

function opportunityForPosition(position: number, totalProducts: number) {
  if (position <= 12) {
    return Math.max(0.6, 1 - (position - 1) * 0.035);
  }

  const tailLength = Math.max(1, totalProducts - 12);
  const depthIntoTail = clamp((position - 12) / tailLength, 0, 1);

  // EXPOSURE_TAIL_DECAY_RATE (2.4) is chosen so a product in the very last
  // slot of ANY collection lands at the same ~5% floor the old fixed-decay
  // curve used (0.55 * e^-2.4 ≈ 0.05) - preserving "the deepest-buried
  // products still read as roughly equally neglected" while fixing the fact
  // every product used to hit that floor at the same fixed absolute
  // position regardless of how deep the collection actually goes.
  return Math.max(
    0.05,
    0.55 * Math.exp(-depthIntoTail * EXPOSURE_TAIL_DECAY_RATE)
  );
}

function exposureBreakdown(
  productId: string,
  runOrders: string[][],
  currentPosition: number,
  currentTotalProducts: number
) {
  const opportunities = runOrders
    .map((order) => {
      const index = order.indexOf(productId);
      // Each historical run's own length is that run's real collection
      // size at the time - using it (rather than the current size) keeps
      // past positions honest even if products have since been added to or
      // removed from the collection.
      return index === -1
        ? null
        : opportunityForPosition(index + 1, order.length);
    })
    .filter((value): value is number => value !== null);

  if (opportunities.length === 0) {
    const assumedOpportunity = opportunityForPosition(
      currentPosition,
      currentTotalProducts
    );
    return {
      need: clamp((1 - assumedOpportunity) * 100),
      appearedInRuns: 0,
      totalRuns: runOrders.length,
      averageOpportunityPercent: clamp(assumedOpportunity * 100),
      usedCurrentPositionFallback: true,
    };
  }

  const average =
    opportunities.reduce((sum, value) => sum + value, 0) /
    opportunities.length;

  return {
    need: clamp((1 - average) * 100),
    appearedInRuns: opportunities.length,
    totalRuns: runOrders.length,
    averageOpportunityPercent: clamp(average * 100),
    usedCurrentPositionFallback: false,
  };
}

function freshnessScore(createdAt: Date, now: Date) {
  const ageDays = Math.max(
    0,
    (now.getTime() - createdAt.getTime()) / 86_400_000
  );

  return clamp(100 * Math.exp(-ageDays / 28));
}

export function scoreProducts(input: {
  products: ScoringProduct[];
  metrics: Map<string, ProductMetric>;
  runOrders: string[][];
  weights: RotationWeights;
  seed: string;
  now?: Date;
  // A caller may already have filtered `products` down to a subset (e.g.
  // out-of-stock products excluded before scoring) - when that happens, a
  // product's index in `products` no longer matches its real position in
  // the full collection, and `products.length` no longer matches the real
  // collection size. Exposure's cold-start fallback and its position-based
  // decay both need the REAL position/size to be meaningful, so a caller in
  // that situation should supply them here. Defaults to the in-array
  // index/length when omitted, which is correct whenever `products` already
  // represents the whole collection (e.g. the verify scripts below).
  realPositions?: Map<string, number>;
  realCollectionSize?: number;
}) {
  const weights = normalizeWeights(input.weights);
  const now = input.now ?? new Date();
  const realCollectionSize =
    input.realCollectionSize ?? input.products.length;
  const metrics = input.products.map(
    (product) =>
      input.metrics.get(product.legacyResourceId) ?? {
        productId: product.legacyResourceId,
        productViews: 0,
        listViews: 0,
        listClicks: 0,
        addsToCart: 0,
        purchases: 0,
        unitsSold: 0,
        revenue: 0,
        priorUnitsSold: 0,
        hasPriorWindowData: false,
        currentWindowCoverage: 1,
        priorWindowCoverage: 1,
        hasCoverageData: false,
        availableInventory: 0,
        hasInventoryData: false,
        unexplainedShrinkage: 0,
        sources: [],
        newestSyncAt: null,
      }
  );

  // Performance is built entirely from Shopify Reports + inventory data -
  // metrics that are actually available - rather than the page-view/cart-add
  // tracking GA4 would otherwise supply. Views and cart-add rate were
  // dropped: without GA4 they always tied every product at a neutral 50th
  // percentile, contributing nothing but dead weight. "Purchase rate" was
  // also retired - dividing by (views + 20) when views is always 0 made it
  // mathematically identical to just ranking by raw purchase count, which
  // Units Sold already captures more directly.
  //
  // The four sub-metrics below are each a genuinely distinct signal:
  //   - Units Sold: raw sales volume.
  //   - Revenue: dollar value generated (rewards higher-ticket items).
  //   - Sales Momentum: is this product's pace accelerating or slowing,
  //     comparing the current window to the equal-length window before it.
  //     This is the closest available substitute for "growing interest"
  //     that doesn't require any page-view tracking.
  //   - Sell-Through Rate: units sold relative to how much inventory is
  //     actually on hand - a product moving fast against thin stock is a
  //     different (and useful) signal from raw volume or revenue alone.
  const unitRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(metric.unitsSold))
  );
  const revenueRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(Math.max(0, metric.revenue)))
  );
  // Smoothing constants below follow the same additive-smoothing approach
  // already used elsewhere in this formula (e.g. the old purchase-rate
  // math), so a product with only 1-2 orders - or no prior-window/inventory
  // data synced yet - doesn't produce a wildly overconfident ratio.
  const MOMENTUM_SMOOTHING = 3;
  // A product must have actually been in stock for at least this fraction of
  // BOTH the current and prior window before its momentum ratio is eligible
  // at all - otherwise a restock landing near the window boundary (arriving
  // mid-prior-window, or mid-current-window right after a full prior
  // stockout) reads as a huge swing that's really just a timing artifact,
  // not real demand change. This stays a hard cutoff (not a ramp) since it's
  // answering a different question than volume confidence below - whether
  // the two windows are comparable at all, not how much to trust the result.
  const MOMENTUM_MIN_WINDOW_COVERAGE = 0.5;
  // Even once eligible, a handful of total sales isn't enough to fully trust
  // a ratio - e.g. one unit of a rare specimen selling the day it arrived
  // would otherwise look like an enormous spike. Rather than a second hard
  // cutoff, confidence ramps continuously from 0 (right at the eligibility
  // floor) up to 1 (comfortably higher volume), so a product that just
  // barely qualifies isn't treated the same as an established seller.
  const MOMENTUM_MIN_COMBINED_UNITS = 4;
  const MOMENTUM_FULL_CONFIDENCE_UNITS = 20;
  const isMomentumEligible = (metric: ProductMetric) =>
    metric.hasPriorWindowData &&
    metric.currentWindowCoverage >= MOMENTUM_MIN_WINDOW_COVERAGE &&
    metric.priorWindowCoverage >= MOMENTUM_MIN_WINDOW_COVERAGE;
  const momentumConfidenceFor = (metric: ProductMetric) => {
    if (!isMomentumEligible(metric)) return 0;
    const combinedUnits = metric.unitsSold + metric.priorUnitsSold;
    return confidenceRamp(
      combinedUnits,
      MOMENTUM_MIN_COMBINED_UNITS,
      MOMENTUM_FULL_CONFIDENCE_UNITS
    );
  };
  const momentumRanks = percentileRanks(
    metrics.map((metric) => {
      const confidence = momentumConfidenceFor(metric);
      if (confidence <= 0) {
        // Not eligible, or eligible but with essentially no volume behind
        // it - assume flat rather than let a restock-timing artifact or a
        // single sale produce a misleading spike or dip.
        return 1;
      }
      // Rather than comparing raw unit counts (which assumes both windows
      // were equally sellable), scale each window's units up by how much of
      // it the product was actually in stock, so a window it was only
      // partly available for is compared on the demand rate it implies, not
      // the smaller raw total that partial availability alone would produce.
      const adjustedCurrent =
        metric.unitsSold / Math.max(MOMENTUM_MIN_WINDOW_COVERAGE, metric.currentWindowCoverage);
      const adjustedPrior =
        metric.priorUnitsSold / Math.max(MOMENTUM_MIN_WINDOW_COVERAGE, metric.priorWindowCoverage);
      const rawRatio =
        (adjustedCurrent + MOMENTUM_SMOOTHING) /
        (adjustedPrior + MOMENTUM_SMOOTHING);
      // Blend toward 1 ("no change") in proportion to how little volume
      // supports this ratio, so a product that just cleared the eligibility
      // floor lands close to neutral instead of getting the full swing.
      return confidence * rawRatio + (1 - confidence) * 1;
    })
  );
  const SELL_THROUGH_SMOOTHING = 2;
  // Units that vanished from stock with no matching order (unexplainedShrinkage
  // - e.g. an unlabeled livestock death) get added back to "available" here,
  // so they read as neither sold nor a real depletion of stock rather than
  // inflating Sell-Through as if a customer had bought them.
  const effectiveAvailableFor = (metric: ProductMetric) => {
    const available = metric.hasInventoryData
      ? metric.availableInventory
      : metric.unitsSold;
    return available + Math.max(0, metric.unexplainedShrinkage);
  };
  // Same underlying issue as momentum: a small total batch (units sold +
  // what's left) can swing to a dramatic-looking ratio off a single unit -
  // 1 sold of 1 available reads as a "hot" 75%, but that's noise, not
  // signal. Confidence ramps on total transaction volume rather than a hard
  // cutoff, using the same anchor points as momentum for consistency.
  const SELL_THROUGH_MIN_TOTAL_UNITS = 4;
  const SELL_THROUGH_FULL_CONFIDENCE_UNITS = 20;
  const sellThroughRawRatios = metrics.map((metric) => {
    const effectiveAvailable = effectiveAvailableFor(metric);
    return (
      (metric.unitsSold + SELL_THROUGH_SMOOTHING) /
      (metric.unitsSold + effectiveAvailable + SELL_THROUGH_SMOOTHING)
    );
  });
  const sellThroughRawRanks = percentileRanks(sellThroughRawRatios);
  const sellThroughConfidenceFor = (metric: ProductMetric) => {
    const totalUnits = metric.unitsSold + effectiveAvailableFor(metric);
    return confidenceRamp(
      totalUnits,
      SELL_THROUGH_MIN_TOTAL_UNITS,
      SELL_THROUGH_FULL_CONFIDENCE_UNITS
    );
  };
  // Sell-through has no collection-independent "neutral ratio" the way
  // momentum's "1" (no change) is - what counts as a normal turnover rate
  // depends on the rest of this collection. So instead of blending the raw
  // ratio toward a fixed anchor before ranking, blend the already-computed
  // percentile toward the neutral 50th percentile after ranking.
  const sellThroughRanks = metrics.map((metric, index) => {
    const confidence = sellThroughConfidenceFor(metric);
    return confidence * sellThroughRawRanks[index] + (1 - confidence) * 50;
  });

  const scores = input.products.map((product, index) => {
    const metric = metrics[index];
    const performance =
      unitRanks[index] * 0.3 +
      revenueRanks[index] * 0.2 +
      momentumRanks[index] * 0.3 +
      sellThroughRanks[index] * 0.2;
    const currentPosition =
      input.realPositions?.get(product.id) ?? index + 1;
    const exposureInfo = exposureBreakdown(
      product.id,
      input.runOrders,
      currentPosition,
      realCollectionSize
    );
    const exposure = exposureInfo.need;
    const freshness = freshnessScore(product.createdAt, now);
    const ageDays = Math.max(
      0,
      (now.getTime() - product.createdAt.getTime()) / 86_400_000
    );
    const exploration =
      hashUnit(`${input.seed}:${product.id}`) * 100;
    const score =
      (performance * weights.performance +
        exposure * weights.exposure +
        freshness * weights.freshness +
        exploration * weights.exploration) /
      100;

    return {
      productId: product.id,
      title: product.title,
      score,
      performance,
      exposure,
      freshness,
      exploration,
      ageDays: Math.round(ageDays),
      metrics: metric,
      breakdown: {
        performance: {
          unitsRank: unitRanks[index],
          unitsWeight: 30,
          revenueRank: revenueRanks[index],
          revenueWeight: 20,
          momentumRank: momentumRanks[index],
          momentumWeight: 30,
          priorUnitsSold: metric.hasPriorWindowData
            ? metric.priorUnitsSold
            : metric.unitsSold,
          hasPriorWindowData: metric.hasPriorWindowData,
          currentWindowCoverage: metric.currentWindowCoverage,
          priorWindowCoverage: metric.priorWindowCoverage,
          hasCoverageData: metric.hasCoverageData,
          momentumEligible: isMomentumEligible(metric),
          momentumConfidence: momentumConfidenceFor(metric),
          sellThroughRank: sellThroughRanks[index],
          sellThroughWeight: 20,
          sellThroughConfidence: sellThroughConfidenceFor(metric),
          availableInventory: metric.hasInventoryData
            ? metric.availableInventory
            : metric.unitsSold,
          hasInventoryData: metric.hasInventoryData,
          unexplainedShrinkage: Math.max(0, metric.unexplainedShrinkage),
          effectiveAvailable: effectiveAvailableFor(metric),
        },
        exposure: {
          appearedInRuns: exposureInfo.appearedInRuns,
          totalRuns: exposureInfo.totalRuns,
          averageOpportunityPercent: exposureInfo.averageOpportunityPercent,
          usedCurrentPositionFallback: exposureInfo.usedCurrentPositionFallback,
        },
        freshness: {
          ageDays: Math.round(ageDays),
          halfLifeDays: 28,
        },
        exploration: {
          seed: input.seed,
          productId: product.id,
        },
      },
      previousPosition: currentPosition,
      proposedPosition: 0,
    } satisfies ProductScore;
  });

  scores.sort(
    (first, second) =>
      second.score - first.score ||
      first.productId.localeCompare(second.productId)
  );
  scores.forEach((score, index) => {
    score.proposedPosition = index + 1;
  });

  return scores;
}
