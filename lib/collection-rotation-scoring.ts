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
  // Current on-hand inventory (summed across locations) - powers the
  // Sell-Through Rate sub-metric. hasInventoryData is false if this product
  // has never had an inventory webhook recorded.
  availableInventory: number;
  hasInventoryData: boolean;
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
    sellThroughRank: number;
    sellThroughWeight: number;
    availableInventory: number;
    hasInventoryData: boolean;
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

function opportunityForPosition(position: number) {
  if (position <= 12) {
    return Math.max(0.6, 1 - (position - 1) * 0.035);
  }

  return Math.max(0.05, 0.55 * Math.exp(-(position - 12) / 20));
}

function exposureBreakdown(
  productId: string,
  runOrders: string[][],
  currentPosition: number
) {
  const opportunities = runOrders
    .map((order) => {
      const index = order.indexOf(productId);
      return index === -1 ? null : opportunityForPosition(index + 1);
    })
    .filter((value): value is number => value !== null);

  if (opportunities.length === 0) {
    const assumedOpportunity = opportunityForPosition(currentPosition);
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
}) {
  const weights = normalizeWeights(input.weights);
  const now = input.now ?? new Date();
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
        availableInventory: 0,
        hasInventoryData: false,
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
  const momentumRanks = percentileRanks(
    metrics.map((metric) => {
      // No prior-period sync yet for this product: assume flat (recent ==
      // prior) rather than guessing a trend from nothing.
      const priorUnits = metric.hasPriorWindowData
        ? metric.priorUnitsSold
        : metric.unitsSold;
      return (
        (metric.unitsSold + MOMENTUM_SMOOTHING) /
        (priorUnits + MOMENTUM_SMOOTHING)
      );
    })
  );
  const SELL_THROUGH_SMOOTHING = 2;
  const sellThroughRanks = percentileRanks(
    metrics.map((metric) => {
      // No inventory webhook recorded yet for this product: assume stock
      // roughly matches units sold (~50% sell-through) rather than
      // guessing efficiency from nothing.
      const available = metric.hasInventoryData
        ? metric.availableInventory
        : metric.unitsSold;
      return (
        (metric.unitsSold + SELL_THROUGH_SMOOTHING) /
        (metric.unitsSold + available + SELL_THROUGH_SMOOTHING)
      );
    })
  );

  const scores = input.products.map((product, index) => {
    const metric = metrics[index];
    const performance =
      unitRanks[index] * 0.3 +
      revenueRanks[index] * 0.2 +
      momentumRanks[index] * 0.3 +
      sellThroughRanks[index] * 0.2;
    const exposureInfo = exposureBreakdown(
      product.id,
      input.runOrders,
      index + 1
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
          sellThroughRank: sellThroughRanks[index],
          sellThroughWeight: 20,
          availableInventory: metric.hasInventoryData
            ? metric.availableInventory
            : metric.unitsSold,
          hasInventoryData: metric.hasInventoryData,
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
      previousPosition: index + 1,
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
