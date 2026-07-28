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
  productViews: number;
  listViews: number;
  listClicks: number;
  addsToCart: number;
  purchases: number;
  unitsSold: number;
  revenue: number;
  sources: string[];
  newestSyncAt: string | null;
};

export type ProductScoreBreakdown = {
  performance: {
    viewRank: number;
    viewWeight: number;
    cartRateRank: number;
    cartRateWeight: number;
    purchaseRateRank: number;
    purchaseRateWeight: number;
    unitRank: number;
    unitWeight: number;
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
        sources: [],
        newestSyncAt: null,
      }
  );

  const viewRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(metric.productViews))
  );
  const cartRateRanks = percentileRanks(
    metrics.map(
      (metric) => (metric.addsToCart + 1) / (metric.productViews + 12)
    )
  );
  const purchaseRateRanks = percentileRanks(
    metrics.map(
      (metric) => (metric.purchases + 0.5) / (metric.productViews + 20)
    )
  );
  const unitRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(metric.unitsSold))
  );
  const revenueRanks = percentileRanks(
    metrics.map((metric) => Math.log1p(Math.max(0, metric.revenue)))
  );

  const scores = input.products.map((product, index) => {
    const metric = metrics[index];
    const performance =
      viewRanks[index] * 0.2 +
      cartRateRanks[index] * 0.2 +
      purchaseRateRanks[index] * 0.25 +
      unitRanks[index] * 0.25 +
      revenueRanks[index] * 0.1;
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
          viewRank: viewRanks[index],
          viewWeight: 20,
          cartRateRank: cartRateRanks[index],
          cartRateWeight: 20,
          purchaseRateRank: purchaseRateRanks[index],
          purchaseRateWeight: 25,
          unitRank: unitRanks[index],
          unitWeight: 25,
          revenueRank: revenueRanks[index],
          revenueWeight: 10,
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
