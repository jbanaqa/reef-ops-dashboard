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
  // Units sold in the equal-length window immediately before this one.
  // Previously powered the Sales Momentum sub-metric, which was retired from
  // Performance scoring as too noisy in practice (small sample sizes and
  // restock timing produced misleading swings). Kept on this type - rather
  // than removed - in case a future revisit finds a more reliable way to use
  // it; nothing currently reads these for scoring.
  priorUnitsSold: number;
  hasPriorWindowData: boolean;
  // What fraction (0-1) of the current/prior lookback window this product
  // actually had stock on hand, reconstructed from InventoryEvent history.
  // Same status as priorUnitsSold above - no longer read by scoring now that
  // Sales Momentum is retired, kept for potential future reuse.
  currentWindowCoverage: number;
  priorWindowCoverage: number;
  hasCoverageData: boolean;
  // Current on-hand inventory (summed across locations). Still actively used
  // - not by Performance scoring (Sell-Through Rate was retired for the same
  // noisiness reason as Momentum), but to exclude confirmed out-of-stock
  // products from scoring entirely (see isConfirmedOutOfStock in
  // collection-rotation-plan.ts). hasInventoryData is false if this product
  // has never had an inventory webhook recorded.
  availableInventory: number;
  hasInventoryData: boolean;
  // Units that disappeared from inventory during the lookback window with no
  // matching Shopify order behind them (from InventoryEvent.unknownChangeQuantity
  // - e.g. livestock deaths or other manual write-offs with no reason code
  // attached). Previously fed back into Sell-Through Rate's "available"
  // figure; no longer read now that Sell-Through is retired from Performance
  // scoring. Kept for potential future reuse. 0 genuinely means "no untracked
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
// had: 100% opportunity at position 1, decaying to a floor of 60% by
// position 12.
//
// Past position 12, opportunity decays as a fraction of the collection's
// ACTUAL remaining depth (0 just past the top 12, 1 at the very last
// product) rather than a fixed absolute distance - so the decay always
// spans the collection's whole real tail no matter how many products it
// has (a product halfway back scores the same whether the collection has
// 60 products or 6,000).
//
// That decay is LINEAR, not exponential. An earlier exponential version
// dropped fast early and then flattened out, so most of a large
// collection's products - which mostly live in the back half of the tail -
// all landed within a narrow ~20-point band near the top of the scale
// ("everything scores 70-100, spread under 30"). A straight line spends
// the same 0-100 "need" range evenly across the ENTIRE tail, proportional
// to how deep a product actually sits, so the Exposure weight has a real,
// visible effect without needing to be turned up to dominate the score.
// It's anchored at TOP_TIER_OPPORTUNITY_FLOOR so there's no jump at the
// position-12/13 boundary, and runs all the way to 0 opportunity (100
// "need") at the true last position - the full range is always reachable,
// regardless of collection size.
const TOP_TIER_OPPORTUNITY_FLOOR = 0.6;

function opportunityForPosition(position: number, totalProducts: number) {
  if (position <= 12) {
    return Math.max(TOP_TIER_OPPORTUNITY_FLOOR, 1 - (position - 1) * 0.035);
  }

  const tailLength = Math.max(1, totalProducts - 12);
  const depthIntoTail = clamp((position - 12) / tailLength, 0, 1);

  return TOP_TIER_OPPORTUNITY_FLOOR * (1 - depthIntoTail);
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

  // Performance is built entirely from Shopify Reports data - metrics that
  // are actually available - rather than the page-view/cart-add tracking
  // GA4 would otherwise supply. Views and cart-add rate were dropped:
  // without GA4 they always tied every product at a neutral 50th
  // percentile, contributing nothing but dead weight. "Purchase rate" was
  // also retired - dividing by (views + 20) when views is always 0 made it
  // mathematically identical to just ranking by raw purchase count, which
  // Units Sold already captures more directly. Sales Momentum and
  // Sell-Through Rate were retired too - both depended on reconstructed
  // prior-window/inventory-coverage data that proved too noisy in practice
  // (small sample sizes and restock timing produced misleading swings) to
  // be a reliable signal, per direct feedback that they read as inaccurate.
  //
  // What's left is two simple, direct signals:
  //   - Units Sold: raw sales volume.
  //   - Revenue: dollar value generated (rewards higher-ticket items).
  // Units Sold keeps the larger share (60/40) to preserve the original
  // relative weighting between the two (previously 30/20 out of the old
  // four-way split).
  const unitRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(metric.unitsSold))
  );
  const revenueRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(Math.max(0, metric.revenue)))
  );

  const scores = input.products.map((product, index) => {
    const metric = metrics[index];
    const performance = unitRanks[index] * 0.6 + revenueRanks[index] * 0.4;
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
          unitsWeight: 60,
          revenueRank: revenueRanks[index],
          revenueWeight: 40,
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
