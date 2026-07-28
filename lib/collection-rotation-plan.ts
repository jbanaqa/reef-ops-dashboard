import { prisma } from "@/lib/prisma";
import type {
  CollectionProduct,
} from "@/lib/collection-rotation";
import {
  scoreProducts,
  STRATEGY_PRESETS,
  type ProductMetric,
  type RotationStrategy,
  type RotationWeights,
} from "@/lib/collection-rotation-scoring";

type RotationConfiguration = {
  id: string;
  strategy: string;
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
  analyticsLookbackDays: number;
  controlledTopCount: number;
  controlledProducts: Array<{
    shopifyProductId: string;
    position: number;
  }>;
};

function parseProductOrder(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numericProductId(productId: string) {
  const match = productId.match(/gid:\/\/shopify\/Product\/(\d+)/);
  return match?.[1] ?? productId;
}

function configuredWeights(rotation: RotationConfiguration): RotationWeights {
  const strategy = rotation.strategy as RotationStrategy;

  if (strategy !== "CUSTOM" && strategy in STRATEGY_PRESETS) {
    return STRATEGY_PRESETS[
      strategy as Exclude<RotationStrategy, "CUSTOM">
    ];
  }

  return {
    performance: rotation.performanceWeight,
    exposure: rotation.exposureWeight,
    freshness: rotation.freshnessWeight,
    exploration: rotation.explorationWeight,
  };
}

function applyControlledPositions(
  productIds: string[],
  rankedProductIds: string[],
  rotation: RotationConfiguration
) {
  const controlledTopCount = Math.min(
    Math.max(0, rotation.controlledTopCount),
    productIds.length
  );
  const validIds = new Set(productIds);
  const usedIds = new Set<string>();
  const assignments = rotation.controlledProducts
    .filter(
      (rule) =>
        rule.position >= 1 &&
        rule.position <= controlledTopCount &&
        validIds.has(rule.shopifyProductId) &&
        !usedIds.has(rule.shopifyProductId)
    )
    .filter((rule) => {
      usedIds.add(rule.shopifyProductId);
      return true;
    });
  const remaining = rankedProductIds.filter(
    (productId) => !usedIds.has(productId)
  );
  const target = new Array<string | null>(productIds.length).fill(null);

  for (const assignment of assignments) {
    target[assignment.position - 1] = assignment.shopifyProductId;
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

export async function buildCollectionRotationPlan(input: {
  shop: string;
  products: CollectionProduct[];
  rotation: RotationConfiguration;
  seed?: string;
}) {
  const lookbackDays = input.rotation.analyticsLookbackDays;
  const windowStartedAt = new Date(
    Date.now() - lookbackDays * 86_400_000
  );
  const productIds = input.products.map((product) => product.id);
  const numericIds = input.products.map((product) =>
    numericProductId(product.id)
  );
  const [
    analyticsRows,
    priorAnalyticsRows,
    inventoryTotals,
    unexplainedShrinkageTotals,
    orderClaims,
    recentRuns,
    recentSyncs,
  ] = await Promise.all([
      prisma.collectionProductAnalytics.findMany({
        where: {
          shop: input.shop,
          productId: { in: numericIds },
          lookbackDays,
          periodOffset: 0,
        },
      }),
      // The immediately-preceding window of the same length, used only to
      // compute sales momentum (recent vs. prior). Never populated for GA4,
      // and only present once a "Sync analytics" run has synced it at least
      // once - hasPriorWindowData below tracks whether that's happened yet.
      prisma.collectionProductAnalytics.findMany({
        where: {
          shop: input.shop,
          productId: { in: numericIds },
          source: "SHOPIFY_REPORTS",
          lookbackDays,
          periodOffset: 1,
        },
      }),
      prisma.inventorySnapshot.groupBy({
        by: ["productId"],
        where: {
          shop: input.shop,
          productId: { in: numericIds },
        },
        _sum: { available: true },
      }),
      // Units that left inventory during this same window with no matching
      // Shopify order behind them (from finalize-inventory-windows.ts's
      // reconciliation) - e.g. an unlabeled livestock death or other manual
      // write-off. Summed regardless of eventType: only decrement events
      // ever populate unknownChangeQuantity above 0, so restocks and
      // sale-matched decrements naturally contribute nothing here.
      prisma.inventoryEvent.groupBy({
        by: ["productId"],
        where: {
          shop: input.shop,
          productId: { in: numericIds },
          detectedAt: { gte: windowStartedAt },
        },
        _sum: { unknownChangeQuantity: true },
      }),
      prisma.orderInventoryClaim.groupBy({
        by: ["productId"],
        where: {
          shop: input.shop,
          productId: { in: numericIds },
          orderCreatedAt: { gte: windowStartedAt },
        },
        _sum: { quantitySold: true },
        _count: { orderId: true },
      }),
      prisma.collectionRotationRun.findMany({
        where: {
          rotationId: input.rotation.id,
          status: "Completed",
          undoneAt: null,
        },
        orderBy: { completedAt: "desc" },
        take: 42,
        select: { shuffledProductIds: true },
      }),
      prisma.collectionAnalyticsSync.findMany({
        where: {
          shop: input.shop,
          status: "Completed",
        },
        orderBy: { completedAt: "desc" },
        distinct: ["source"],
        take: 4,
      }),
    ]);
  const priorUnitsByProduct = new Map(
    priorAnalyticsRows
      .filter((row) => row.productId)
      .map((row) => [row.productId, row.unitsSold])
  );
  const availableInventoryByProduct = new Map(
    inventoryTotals
      .filter((row) => row.productId)
      .map((row) => [row.productId as string, row._sum.available ?? 0])
  );
  const unexplainedShrinkageByProduct = new Map(
    unexplainedShrinkageTotals
      .filter((row) => row.productId)
      .map((row) => [
        row.productId as string,
        row._sum.unknownChangeQuantity ?? 0,
      ])
  );
  const localOrders = new Map(
    orderClaims
      .filter((row) => row.productId)
      .map((row) => [
        row.productId as string,
        {
          units: row._sum.quantitySold ?? 0,
          orders: row._count.orderId,
        },
      ])
  );
  const analyticsByProduct = new Map<string, typeof analyticsRows>();

  for (const row of analyticsRows) {
    const current = analyticsByProduct.get(row.productId) ?? [];
    current.push(row);
    analyticsByProduct.set(row.productId, current);
  }

  const metrics = new Map<string, ProductMetric>();

  for (const productId of numericIds) {
    const rows = analyticsByProduct.get(productId) ?? [];
    const ga4 = rows.find((row) => row.source === "GA4");
    const shopify = rows.find((row) => row.source === "SHOPIFY_REPORTS");
    const local = localOrders.get(productId);
    const sales = shopify ?? ga4;
    const sources = [
      ...(ga4 ? ["GA4"] : []),
      ...(shopify ? ["SHOPIFY_REPORTS"] : []),
      ...(local ? ["REEF_OPS_ORDERS"] : []),
    ];

    metrics.set(productId, {
      productId,
      productViews: ga4?.productViews ?? 0,
      listViews: ga4?.listViews ?? 0,
      listClicks: ga4?.listClicks ?? 0,
      addsToCart: ga4?.addsToCart ?? 0,
      purchases: sales?.purchases ?? local?.orders ?? 0,
      unitsSold: sales?.unitsSold ?? local?.units ?? 0,
      revenue: sales?.revenue ?? 0,
      priorUnitsSold: priorUnitsByProduct.get(productId) ?? 0,
      hasPriorWindowData: priorUnitsByProduct.has(productId),
      availableInventory: availableInventoryByProduct.get(productId) ?? 0,
      hasInventoryData: availableInventoryByProduct.has(productId),
      unexplainedShrinkage: unexplainedShrinkageByProduct.get(productId) ?? 0,
      sources,
      newestSyncAt:
        rows.length > 0
          ? new Date(Math.max(...rows.map((row) => row.syncedAt.getTime()))).toISOString()
          : null,
    });
  }

  const seed =
    input.seed ??
    `${input.rotation.id}:${Math.floor(Date.now() / 14_400_000)}`;
  const scores = scoreProducts({
    products: input.products.map((product) => ({
      id: product.id,
      legacyResourceId: product.legacyResourceId,
      title: product.title,
      createdAt: new Date(product.createdAt),
    })),
    metrics,
    runOrders: recentRuns
      .map((run) => parseProductOrder(run.shuffledProductIds))
      .filter((order) => order.length > 0),
    weights: configuredWeights(input.rotation),
    seed,
  });
  // A product with confirmed zero stock shouldn't occupy a visible top slot:
  // Shopify's storefront won't actually show/sell it there, so a "top 12"
  // that includes it doesn't match what a shopper will really see - some
  // other in-stock product would slide up to fill that spot anyway. This is
  // a stable partition applied only to final ordering, after scoring: a
  // sold-out product's Performance/Exposure/Freshness/Exploration are still
  // computed normally (via the `scores` array above), so it isn't unfairly
  // penalized on exposure history once it's back in stock. Only manually
  // "controlled" top positions (handled next) are exempt, since those are an
  // explicit merchant override.
  function isConfirmedOutOfStock(productId: string) {
    const metric = metrics.get(numericProductId(productId));
    return Boolean(metric?.hasInventoryData) && (metric?.availableInventory ?? 0) <= 0;
  }
  const stockAwareOrder = [
    ...scores
      .filter((score) => !isConfirmedOutOfStock(score.productId))
      .map((score) => score.productId),
    ...scores
      .filter((score) => isConfirmedOutOfStock(score.productId))
      .map((score) => score.productId),
  ];
  const targetProductIds = applyControlledPositions(
    productIds,
    stockAwareOrder,
    input.rotation
  );
  const targetPosition = new Map(
    targetProductIds.map((productId, index) => [productId, index + 1])
  );

  scores.forEach((score) => {
    score.proposedPosition =
      targetPosition.get(score.productId) ?? score.proposedPosition;
  });
  scores.sort(
    (first, second) => first.proposedPosition - second.proposedPosition
  );

  const sourceSet = new Set(
    [...metrics.values()].flatMap((metric) => metric.sources)
  );
  const hasBehavior = sourceSet.has("GA4");
  const hasSales =
    sourceSet.has("SHOPIFY_REPORTS") || sourceSet.has("REEF_OPS_ORDERS");
  const confidence = hasBehavior && hasSales ? "HIGH" : hasSales ? "MEDIUM" : "LOW";

  return {
    seed,
    strategy: input.rotation.strategy as RotationStrategy,
    weights: configuredWeights(input.rotation),
    targetProductIds,
    scores,
    confidence,
    sources: [...sourceSet],
    runHistoryCount: recentRuns.length,
    latestSyncs: recentSyncs.map((sync) => ({
      source: sync.source,
      completedAt: sync.completedAt?.toISOString() ?? null,
      rowCount: sync.rowCount,
    })),
  };
}
