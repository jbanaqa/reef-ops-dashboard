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
import {
  computeWindowCoverage,
  type InventoryChangeEvent,
} from "@/lib/inventory-coverage";

type RotationConfiguration = {
  id: string;
  strategy: string;
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
  analyticsLookbackDays: number;
  controlledTopCount: number;
  controlledBottomCount: number;
  controlledProducts: Array<{
    shopifyProductId: string;
    position: number;
    zone: string;
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
  // Bottom pins claim slots counting up from the end of the collection, so
  // clamp against whatever room the top zone hasn't already claimed - the two
  // zones are never allowed to overlap in the middle.
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

  // Top assignments claim products first so a product referenced by both a
  // (now-invalid, since a product can only be pinned once) top and bottom
  // rule always resolves to its top placement.
  const topAssignments = collectAssignments("TOP", controlledTopCount);
  const bottomAssignments = collectAssignments("BOTTOM", controlledBottomCount);

  const remaining = rankedProductIds.filter(
    (productId) => !usedIds.has(productId)
  );
  const target = new Array<string | null>(productIds.length).fill(null);

  for (const assignment of topAssignments) {
    target[assignment.position - 1] = assignment.shopifyProductId;
  }

  // Bottom position 1 = the very last slot, position 2 = second-to-last, etc.
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

export async function buildCollectionRotationPlan(input: {
  shop: string;
  products: CollectionProduct[];
  rotation: RotationConfiguration;
  seed?: string;
}) {
  const lookbackDays = input.rotation.analyticsLookbackDays;
  const now = new Date();
  const windowStartedAt = new Date(
    now.getTime() - lookbackDays * 86_400_000
  );
  // The window immediately before the current one, same length - mirrors
  // fetchShopifyReportMetrics's periodOffset:1 boundaries exactly, so the
  // coverage numbers below line up with the unitsSold/priorUnitsSold pair
  // sales momentum is already comparing.
  const priorWindowStartedAt = new Date(
    windowStartedAt.getTime() - lookbackDays * 86_400_000
  );
  // Exposure averages a product's historical position across its recent
  // runs to decide who's been neglected lately. Averaging across a
  // collection's ENTIRE run history (as this briefly did) turned out to
  // wash the signal out: Exposure is a self-correcting fairness mechanic,
  // so given enough historical rounds, every product's long-run average
  // position converges toward the same middle-of-the-pack value almost
  // regardless of its actual quality - that's what "the system successfully
  // equalized exposure over time" looks like statistically, but it leaves
  // nothing left to differentiate the NEXT shuffle with. A recent window
  // keeps Exposure answering "who's been under-exposed lately" instead of
  // "who's been under-exposed on lifetime average." Time-based (rather than
  // a fixed run count) so this stays meaningful even if the automation
  // schedule interval ever changes.
  const EXPOSURE_HISTORY_WINDOW_DAYS = 3;
  const exposureWindowStartedAt = new Date(
    now.getTime() - EXPOSURE_HISTORY_WINDOW_DAYS * 86_400_000
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
    inventoryChangeEvents,
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
      // Full inventory-change history (not scoped to either window) so the
      // coverage reconstruction below can walk backward through everything
      // between "now" and the prior window's start and land on the right
      // stock level at every point in between - see inventory-coverage.ts.
      prisma.inventoryEvent.findMany({
        where: {
          shop: input.shop,
          productId: { in: numericIds },
          detectedAt: { lte: now },
        },
        orderBy: { detectedAt: "asc" },
        select: {
          productId: true,
          detectedAt: true,
          netDelta: true,
          startingAvailable: true,
        },
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
      // Completed, non-undone runs from the last EXPOSURE_HISTORY_WINDOW_DAYS
      // days only - see the comment on that constant above for why Exposure
      // needs a recent window rather than a collection's entire run history.
      // Older runs still exist in the database either way - nothing about a
      // rotation history is ever deleted - this just stops them from
      // counting toward Exposure once they've aged out of the window. The
      // composite index on [rotationId, status, undoneAt, completedAt] in
      // schema.prisma covers this query too (the added completedAt lower
      // bound still resolves via an index range scan).
      prisma.collectionRotationRun.findMany({
        where: {
          rotationId: input.rotation.id,
          status: "Completed",
          undoneAt: null,
          completedAt: { gte: exposureWindowStartedAt },
        },
        orderBy: { completedAt: "desc" },
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
  const inventoryEventsByProduct = new Map<string, InventoryChangeEvent[]>();

  for (const event of inventoryChangeEvents) {
    if (!event.productId) continue;
    const current = inventoryEventsByProduct.get(event.productId) ?? [];
    current.push({
      detectedAt: event.detectedAt,
      netDelta: event.netDelta,
      startingAvailable: event.startingAvailable,
    });
    inventoryEventsByProduct.set(event.productId, current);
  }

  const windowCoverageFor = (productId: string, windowStart: Date, windowEnd: Date) =>
    computeWindowCoverage({
      events: inventoryEventsByProduct.get(productId) ?? [],
      currentAvailable: availableInventoryByProduct.get(productId) ?? 0,
      windowStart,
      windowEnd,
      now,
    });
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
    const currentCoverage = windowCoverageFor(productId, windowStartedAt, now);
    const priorCoverage = windowCoverageFor(
      productId,
      priorWindowStartedAt,
      windowStartedAt
    );
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
      currentWindowCoverage: currentCoverage.coverage,
      priorWindowCoverage: priorCoverage.coverage,
      hasCoverageData: currentCoverage.hasCoverageData || priorCoverage.hasCoverageData,
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

  // A product with confirmed zero stock shouldn't be scored or placed at
  // all: Shopify's storefront won't actually show/sell it wherever it lands,
  // so there's no real "position" to compute for it - some other in-stock
  // product would occupy that slot anyway. Excluding these products from
  // scoreProducts entirely (rather than scoring them and sorting them to the
  // bottom afterward) also keeps them from diluting the percentile-rank
  // baseline that every in-stock product's Performance is measured against.
  // Only manually "controlled" top positions (handled below) can still pin
  // an out-of-stock product, since that's an explicit merchant override.
  function isConfirmedOutOfStock(productId: string) {
    const metric = metrics.get(numericProductId(productId));
    return Boolean(metric?.hasInventoryData) && (metric?.availableInventory ?? 0) <= 0;
  }
  // Same reasoning applies to archived/draft products: Shopify collection
  // membership doesn't automatically drop a product just because it's been
  // archived or unpublished, but neither status is ever visible or
  // purchasable on the storefront either - so there's nothing to score or
  // place here regardless of what its inventory count happens to read.
  function isUnpublished(product: CollectionProduct) {
    return product.status !== "ACTIVE";
  }
  const inStockProducts = input.products.filter(
    (product) => !isUnpublished(product) && !isConfirmedOutOfStock(product.id)
  );
  // Preserves the products' original relative order (rather than grouping
  // "archived" and "out of stock" into two separately-concatenated blocks),
  // same as the single-reason version this replaces.
  const unavailableProducts = input.products.filter(
    (product) => isUnpublished(product) || isConfirmedOutOfStock(product.id)
  );
  const archivedCount = unavailableProducts.filter((product) =>
    isUnpublished(product)
  ).length;
  // Doesn't double-count a product that's both archived AND out of stock -
  // that one's counted under archivedCount only, since archived/unpublished
  // is the more permanent of the two reasons.
  const outOfStockCount = unavailableProducts.length - archivedCount;
  // scoreProducts derives "previousPosition" (and Exposure's fallback
  // position/collection-size) from each product's index in the array it's
  // given, so once unavailable products are filtered out before the call,
  // that index no longer matches the product's real current position or
  // the real collection size. Supply the real values explicitly so both
  // stay accurate even though scoring itself only sees the in-stock,
  // published subset.
  const realPositionByProductId = new Map(
    input.products.map((product, index) => [product.id, index + 1])
  );

  const scores = scoreProducts({
    products: inStockProducts.map((product) => ({
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
    now,
    realPositions: realPositionByProductId,
    realCollectionSize: productIds.length,
  });

  const availabilityAwareOrder = [
    ...scores.map((score) => score.productId),
    ...unavailableProducts.map((product) => product.id),
  ];
  const targetProductIds = applyControlledPositions(
    productIds,
    availabilityAwareOrder,
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
    // Out-of-stock and archived/draft products are both excluded from
    // `scores` above, still present (moved to the end of the collection, in
    // their existing relative order) in `targetProductIds`. Surfaced
    // separately, and split by reason, so the UI can be transparent about
    // why the count here is lower than the collection's total product count.
    outOfStockCount,
    archivedCount,
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
