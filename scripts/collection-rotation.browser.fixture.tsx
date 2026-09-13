// Isolated UI fixture. Every fetch is intercepted; no Shopify or production calls.
import React from "react";
import { createRoot } from "react-dom/client";
import CollectionRotationManager from "../app/collection-rotation/CollectionRotationManager";

const collections = [
  "Torch Corals",
  "New Arrivals",
  "Premium Acropora",
  "Soft Corals",
  "Collector Favorites",
  "Last Chance",
].map((title, index) => ({
  id: `collection-${index}`,
  title,
  handle: title.toLowerCase().replaceAll(" ", "-"),
  legacyResourceId: String(index),
  productsCount: 25 + index * 13,
  sortOrder: "MANUAL",
  isStarred: index < 2,
  isEnabled: index < 3,
  strategy: index === 1 ? "CUSTOM" : "BALANCED",
  controlledTopCount: index === 0 ? 3 : 0,
  controlledAssignedCount: index === 0 ? 3 : 0,
  controlledBottomCount: 0,
  controlledBottomAssignedCount: 0,
  lastShuffledAt: "2026-09-13T14:00:00Z",
  lastStatus: "Completed",
  lastError: null,
  canUndo: true,
}));
const settings = {
  strategy: "CUSTOM",
  performanceWeight: 40,
  exposureWeight: 30,
  freshnessWeight: 20,
  explorationWeight: 10,
  analyticsLookbackDays: 30,
};
const presets = [
  { id: "preset-1", name: "New collection discovery", ...settings },
];
const writes: unknown[] = [];
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin);
  const body = options?.body ? JSON.parse(String(options.body)) : {};
  const post = options?.method === "POST";
  const response = (data: object) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      headers: { "Content-Type": "application/json" },
    });
  if (post) {
    writes.push({ path: url.pathname, body });
    document.getElementById("fixture-writes")!.textContent =
      JSON.stringify(writes);
  }
  if (url.pathname.endsWith("/collections")) return response({ collections });
  if (url.pathname.endsWith("/weight-presets")) {
    if (post) {
      const preset = { ...body, id: "saved-preset" };
      presets.push(preset);
      return response({ preset });
    }
    return response({ presets });
  }
  if (url.pathname.endsWith("/strategy/bulk")) {
    body.collections.forEach((target: { collectionId: string }) => {
      const c = collections.find((c) => c.id === target.collectionId);
      if (c) c.strategy = body.strategy;
    });
    return response({ updatedCount: body.collections.length, failed: [] });
  }
  if (url.pathname.endsWith("/strategy")) return response({ settings });
  if (url.pathname.endsWith("/preview"))
    return response({
      preview: {
        seed: "sample-seed",
        confidence: "MEDIUM",
        sources: ["SHOPIFY_REPORTS"],
        runHistoryCount: 4,
        outOfStockCount: 0,
        archivedCount: 0,
        scores: [
          "NY Knicks Indo Gold Torch",
          "Inferno HellFire Torch",
          "Dragon Soul Torch",
        ].map((title, index) => ({
          productId: `p-${index}`,
          title,
          score: 80 - index * 5,
          performance: 75,
          exposure: 60,
          freshness: 45,
          exploration: 20,
          ageDays: 10,
          previousPosition: 8 - index,
          proposedPosition: index + 1,
          metrics: {
            productViews: 0,
            listViews: 0,
            listClicks: 0,
            addsToCart: 0,
            purchases: 3,
            unitsSold: 4,
            revenue: 400,
            sources: ["SHOPIFY_REPORTS"],
            newestSyncAt: null,
          },
          breakdown: {
            performance: {
              unitsRank: 80,
              unitsWeight: 70,
              revenueRank: 60,
              revenueWeight: 30,
            },
            exposure: {
              appearedInRuns: 2,
              totalRuns: 4,
              averageOpportunityPercent: 30,
              usedCurrentPositionFallback: false,
            },
            freshness: { ageDays: 10, halfLifeDays: 30 },
            exploration: { seed: "sample-seed", productId: `p-${index}` },
          },
        })),
      },
    });
  if (url.pathname.endsWith("/control"))
    return response({
      collection: {
        id: url.searchParams.get("collectionId"),
        title: "Torch Corals",
        productCount: 25,
      },
      controlledTopCount: 0,
      assignments: [],
      controlledBottomCount: 0,
      bottomAssignments: [],
      products: [
        {
          id: "p-0",
          title: "NY Knicks Indo Gold Torch",
          handle: "gold-torch",
          imageUrl: null,
        },
      ],
    });
  if (url.pathname.endsWith("/analytics"))
    return response({ availability: { shopifyReports: true, ga4: false } });
  if (url.pathname.endsWith("/automation"))
    return response({
      serverNow: new Date().toISOString(),
      scheduleEnabled: true,
      intervalMinutes: 180,
      intervalLabel: "Every 3 hours",
      enabledCollectionCount: 3,
      nextScheduledRunAt: new Date(Date.now() + 5400000).toISOString(),
      lastRun: null,
    });
  if (url.pathname.endsWith("/history"))
    return response({
      collection: {
        id: url.searchParams.get("collectionId"),
        title: "Torch Corals",
      },
      runs: [],
    });
  return new Response(
    JSON.stringify({
      ok: false,
      error: "This action is not simulated in the UI fixture.",
    }),
    { status: 400 },
  );
};
createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 1400, margin: "0 auto", padding: "30px" }}>
    <p style={{ color: "#c58d45", fontSize: 11 }}>
      LOCAL UI PREVIEW · SAMPLE DATA · NO LIVE ACTIONS
    </p>
    <CollectionRotationManager />
    <details>
      <summary>Fixture requests</summary>
      <pre id="fixture-writes" />
    </details>
  </main>,
);
