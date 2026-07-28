"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import {
  STRATEGY_LABELS,
  STRATEGY_PRESETS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";

type CollectionOption = {
  id: string;
  title: string;
  productsCount: number;
  isStarred: boolean;
  isEnabled: boolean;
};

type Strategy = RotationStrategy;

type Settings = {
  strategy: Strategy;
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
  analyticsLookbackDays: number;
};

type PreviewScore = {
  productId: string;
  title: string;
  score: number;
  performance: number;
  exposure: number;
  freshness: number;
  exploration: number;
  ageDays: number;
  previousPosition: number;
  proposedPosition: number;
  metrics: {
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
  breakdown: {
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
      momentumEligible: boolean;
      momentumConfidence: number;
      sellThroughRank: number;
      sellThroughWeight: number;
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
};

const SCORE_FACTOR_COPY: Record<
  "performance" | "exposure" | "freshness" | "exploration",
  string
> = {
  performance: "Units sold, revenue, sales momentum, and sell-through rate vs. the rest of this collection — built entirely from Shopify Reports and inventory data, no page-view tracking required.",
  exposure: "How little (or how much) prime real estate this product has gotten in recent rotations.",
  freshness: "How recently this product was added — fades out over about a month.",
  exploration: "A small, reproducible random nudge so the order isn't fully locked in.",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSyncedAt(value: string | null) {
  if (!value) return "Never synced";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isConfirmedOutOfStock(score: PreviewScore) {
  const performance = score.breakdown.performance;
  return performance.hasInventoryData && performance.availableInventory <= 0;
}

function FactorDetail({
  factorKey,
  score,
}: {
  factorKey: "performance" | "exposure" | "freshness" | "exploration";
  score: PreviewScore;
}) {
  if (factorKey === "performance") {
    const performance = score.breakdown.performance;
    const confidencePct = (value: number) => Math.round(value * 100);
    const momentumLabel = (() => {
      if (!performance.hasPriorWindowData) {
        return "Sales momentum (no prior period synced yet)";
      }
      if (!performance.momentumEligible) {
        const currentPct = Math.round(performance.currentWindowCoverage * 100);
        const priorPct = Math.round(performance.priorWindowCoverage * 100);
        return `Sales momentum (not eligible — only in stock ${currentPct}% of the current period vs. ${priorPct}% of the prior period, likely a restock timing gap)`;
      }
      const base = `Sales momentum (${score.metrics.unitsSold} now vs. ${performance.priorUnitsSold} prior period)`;
      if (performance.momentumConfidence >= 0.9) {
        return base;
      }
      return `${base} — ${confidencePct(performance.momentumConfidence)}% confidence, too few total sales yet to fully trust this ratio`;
    })();
    const sellThroughLabel = (() => {
      const base = !performance.hasInventoryData
        ? "Sell-through (inventory not tracked yet)"
        : performance.unexplainedShrinkage > 0
          ? `Sell-through (${score.metrics.unitsSold} sold vs. ${performance.availableInventory} in stock, +${performance.unexplainedShrinkage} unexplained loss excluded)`
          : `Sell-through (${score.metrics.unitsSold} sold vs. ${performance.availableInventory} in stock)`;
      if (!performance.hasInventoryData || performance.sellThroughConfidence >= 0.9) {
        return base;
      }
      return `${base} — ${confidencePct(performance.sellThroughConfidence)}% confidence, small batch so the ratio is noisy`;
    })();
    const rows: Array<{ label: string; rank: number; weight: number }> = [
      {
        label: "Units sold (log-scaled)",
        rank: performance.unitsRank,
        weight: performance.unitsWeight,
      },
      {
        label: "Revenue (log-scaled)",
        rank: performance.revenueRank,
        weight: performance.revenueWeight,
      },
      {
        label: momentumLabel,
        rank: performance.momentumRank,
        weight: performance.momentumWeight,
      },
      {
        label: sellThroughLabel,
        rank: performance.sellThroughRank,
        weight: performance.sellThroughWeight,
      },
    ];

    return (
      <ul className="rotation-score-subbreakdown">
        {rows.map((row) => (
          <li key={row.label}>
            <span>{row.label}</span>
            <strong>
              {row.rank} pct · {row.weight}%
            </strong>
          </li>
        ))}
      </ul>
    );
  }

  if (factorKey === "exposure") {
    const exposure = score.breakdown.exposure;
    return (
      <p className="rotation-score-subbreakdown-note">
        {exposure.usedCurrentPositionFallback
          ? `No saved rotation history yet — estimated from this product's current position, which already gets about ${exposure.averageOpportunityPercent}% of available prime-position opportunity.`
          : `Appeared in ${exposure.appearedInRuns} of ${exposure.totalRuns} saved rotations, averaging ${exposure.averageOpportunityPercent}% of available prime-position opportunity already received.`}
      </p>
    );
  }

  if (factorKey === "freshness") {
    const freshness = score.breakdown.freshness;
    return (
      <p className="rotation-score-subbreakdown-note">
        {freshness.ageDays} days old → 100 × e^(-{freshness.ageDays}/
        {freshness.halfLifeDays}) = {score.freshness}
      </p>
    );
  }

  const exploration = score.breakdown.exploration;
  return (
    <p className="rotation-score-subbreakdown-note">
      Deterministic hash of &ldquo;{exploration.seed}:{exploration.productId}
      &rdquo; → {score.exploration}. Same seed always gives the same nudge; a
      new shuffle seed gives a new one.
    </p>
  );
}

function ScoreBreakdown({
  score,
  weights,
}: {
  score: PreviewScore;
  weights: {
    performanceWeight: number;
    exposureWeight: number;
    freshnessWeight: number;
    explorationWeight: number;
  };
}) {
  const factors: Array<{
    key: "performance" | "exposure" | "freshness" | "exploration";
    label: string;
    value: number;
    weight: number;
  }> = [
    {
      key: "performance",
      label: "Performance",
      value: score.performance,
      weight: weights.performanceWeight,
    },
    {
      key: "exposure",
      label: "Exposure",
      value: score.exposure,
      weight: weights.exposureWeight,
    },
    {
      key: "freshness",
      label: "Freshness",
      value: score.freshness,
      weight: weights.freshnessWeight,
    },
    {
      key: "exploration",
      label: "Exploration",
      value: score.exploration,
      weight: weights.explorationWeight,
    },
  ];

  return (
    <div className="rotation-score-detail">
      <div className="rotation-score-detail-section">
        <h5>Raw data behind this score</h5>
        <div className="rotation-score-detail-grid">
          <div>
            <span>Purchases</span>
            <strong>{score.metrics.purchases.toLocaleString()}</strong>
          </div>
          <div>
            <span>Units sold</span>
            <strong>{score.metrics.unitsSold.toLocaleString()}</strong>
          </div>
          <div>
            <span>Units sold, prior period</span>
            <strong>
              {score.breakdown.performance.hasPriorWindowData
                ? score.breakdown.performance.priorUnitsSold.toLocaleString()
                : "Not synced yet"}
            </strong>
          </div>
          <div>
            <span>In stock, current period</span>
            <strong>
              {score.breakdown.performance.hasCoverageData
                ? `${Math.round(score.breakdown.performance.currentWindowCoverage * 100)}%`
                : "Assumed 100% (no history yet)"}
            </strong>
          </div>
          <div>
            <span>In stock, prior period</span>
            <strong>
              {score.breakdown.performance.hasCoverageData
                ? `${Math.round(score.breakdown.performance.priorWindowCoverage * 100)}%`
                : "Assumed 100% (no history yet)"}
            </strong>
          </div>
          <div>
            <span>Revenue</span>
            <strong>{formatCurrency(score.metrics.revenue)}</strong>
          </div>
          <div>
            <span>Available inventory</span>
            <strong>
              {score.breakdown.performance.hasInventoryData
                ? score.breakdown.performance.availableInventory.toLocaleString()
                : "Not tracked yet"}
            </strong>
          </div>
          <div>
            <span>Product age</span>
            <strong>
              {score.ageDays === 0 ? "Added today" : `${score.ageDays}d old`}
            </strong>
          </div>
        </div>
        <p className="rotation-score-detail-note">
          Sources:{" "}
          {score.metrics.sources.length > 0
            ? score.metrics.sources.join(", ")
            : "none yet (cold start)"}{" "}
          · Last synced: {formatSyncedAt(score.metrics.newestSyncAt)}
        </p>
        {isConfirmedOutOfStock(score) ? (
          <p className="rotation-score-detail-note rotation-out-of-stock-note">
            Zero stock on hand, so this product is parked below every in-stock
            product regardless of score - Shopify wouldn&apos;t actually show
            or sell it in a top slot, so an in-stock product would just take
            its place there anyway. Its score above still reflects its real
            Performance/Exposure/Freshness/Exploration, so it isn&apos;t
            penalized once it&apos;s back in stock.
          </p>
        ) : null}
      </div>

      <div className="rotation-score-detail-section">
        <h5>How the four factors scored</h5>
        <div className="rotation-score-factor-grid">
          {factors.map((factor) => (
            <div key={factor.key} className="rotation-score-factor">
              <div className="rotation-score-factor-heading">
                <strong>{factor.label}</strong>
                <span>
                  {factor.value} × {factor.weight}%
                </span>
              </div>
              <p>{SCORE_FACTOR_COPY[factor.key]}</p>
              <FactorDetail factorKey={factor.key} score={score} />
            </div>
          ))}
        </div>
      </div>

      <div className="rotation-score-detail-section">
        <h5>The math</h5>
        <p className="rotation-score-formula">
          ({factors
            .map((factor) => `${factor.value} × ${factor.weight}`)
            .join(" + ")}) ÷ 100 = <strong>{score.score}</strong>
        </p>
      </div>
    </div>
  );
}

// Weight presets now live in lib/collection-rotation-scoring.ts (the same
// module the server uses to score products), so the picker and the actual
// scoring engine can never drift out of sync with each other.
function presetWeights(
  strategy: Exclude<Strategy, "CUSTOM">
): Omit<Settings, "strategy" | "analyticsLookbackDays"> {
  const preset = STRATEGY_PRESETS[strategy];

  return {
    performanceWeight: preset.performance,
    exposureWeight: preset.exposure,
    freshnessWeight: preset.freshness,
    explorationWeight: preset.exploration,
  };
}

const STRATEGY_COPY: Record<Strategy, string> = {
  BALANCED:
    "Balances recent demand with fair exposure, newer products, and controlled exploration.",
  PERFORMANCE:
    "Leans toward products already showing sales and shopper intent while retaining some rotation.",
  DISCOVERY:
    "Gives buried and newer products more opportunity without ignoring performance.",
  RANDOM:
    "Keeps the original fully random behavior. Controlled positions still stay fixed.",
  CUSTOM:
    "Use your own weights. The four values must add up to 100.",
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string; ok?: boolean };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "The request failed.");
  }
  return data;
}

export default function CollectionStrategyPanel({
  collections,
  onPreviewSeedChange,
}: {
  collections: CollectionOption[];
  onPreviewSeedChange?: (
    collectionId: string,
    seed: string | null
  ) => void;
}) {
  const orderedCollections = useMemo(
    () =>
      [...collections].sort(
        (first, second) =>
          Number(second.isStarred) - Number(first.isStarred) ||
          Number(second.isEnabled) - Number(first.isEnabled) ||
          first.title.localeCompare(second.title)
      ),
    [collections]
  );
  const [collectionId, setCollectionId] = useState("");
  const [settings, setSettings] = useState<Settings>({
    strategy: "BALANCED",
    analyticsLookbackDays: 30,
    ...presetWeights("BALANCED"),
  });
  const [scores, setScores] = useState<PreviewScore[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<
    string | null
  >(null);
  const [previewMeta, setPreviewMeta] = useState<{
    seed: string;
    confidence: string;
    sources: string[];
    runHistoryCount: number;
  } | null>(null);
  const [availability, setAvailability] = useState({
    shopifyReports: true,
    ga4: false,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const activeCollectionId =
    collectionId || orderedCollections[0]?.id || "";

  useEffect(() => {
    if (!activeCollectionId) return;
    let cancelled = false;

    // A different collection is now active, so any previously-generated
    // preview seed no longer applies to whatever gets shuffled next.
    onPreviewSeedChange?.(activeCollectionId, null);

    Promise.resolve().then(() => {
      if (!cancelled) {
        setBusy("settings");
        setScores([]);
        setPreviewMeta(null);
        setExpandedProductId(null);
      }
    });

    Promise.all([
      fetch(
        `/api/collection-rotation/strategy?collectionId=${encodeURIComponent(activeCollectionId)}`,
        { cache: "no-store" }
      ).then((response) =>
        readJson<{ ok: true; settings: Settings }>(response)
      ),
      fetch("/api/collection-rotation/analytics", { cache: "no-store" }).then(
        (response) =>
          readJson<{
            ok: true;
            availability: { shopifyReports: boolean; ga4: boolean };
          }>(response)
      ),
    ])
      .then(([strategyData, analyticsData]) => {
        if (cancelled) return;
        setSettings(strategyData.settings);
        setAvailability(analyticsData.availability);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load strategy."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });

    return () => {
      cancelled = true;
    };
  }, [activeCollectionId]);

  const weightTotal =
    settings.performanceWeight +
    settings.exposureWeight +
    settings.freshnessWeight +
    settings.explorationWeight;

  function chooseStrategy(strategy: Strategy) {
    setSettings((current) => ({
      ...current,
      strategy,
      ...(strategy === "CUSTOM" ? {} : presetWeights(strategy)),
    }));
    setScores([]);
    setPreviewMeta(null);
    setExpandedProductId(null);
    // The scoring configuration just changed, so any earlier preview seed
    // was computed against settings that no longer apply.
    if (activeCollectionId) onPreviewSeedChange?.(activeCollectionId, null);
  }

  function updateWeight(field: keyof Settings, value: number) {
    setSettings((current) => ({
      ...current,
      strategy: "CUSTOM",
      [field]: Math.min(100, Math.max(0, Math.round(value || 0))),
    }));
    setScores([]);
    setPreviewMeta(null);
    setExpandedProductId(null);
    if (activeCollectionId) onPreviewSeedChange?.(activeCollectionId, null);
  }

  async function saveSettings() {
    if (!activeCollectionId || weightTotal !== 100) return;
    setBusy("save");
    setError("");
    setMessage("");

    try {
      await readJson(
        await fetch("/api/collection-rotation/strategy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: activeCollectionId, ...settings }),
        })
      );
      setMessage("Strategy saved. Scheduled and manual rotations now use it.");
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save strategy."
      );
      return false;
    } finally {
      setBusy("");
    }
  }

  async function buildPreview() {
    if (!activeCollectionId) return;
    setBusy("preview");
    setError("");
    setMessage("");

    try {
      const saved = await saveSettings();
      if (!saved) return;
      setBusy("preview");
      const data = await readJson<{
        ok: true;
        preview: {
          seed: string;
          scores: PreviewScore[];
          confidence: string;
          sources: string[];
          runHistoryCount: number;
        };
      }>(
        await fetch(
          `/api/collection-rotation/preview?collectionId=${encodeURIComponent(activeCollectionId)}`,
          { cache: "no-store" }
        )
      );
      setScores(data.preview.scores);
      setPreviewMeta(data.preview);
      setExpandedProductId(null);
      onPreviewSeedChange?.(activeCollectionId, data.preview.seed);
      setMessage(
        "Preview ready. Nothing has been changed in Shopify yet — shuffling this collection now, without changing anything above first, will apply exactly this order."
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Could not build preview."
      );
    } finally {
      setBusy("");
    }
  }

  async function syncAnalytics() {
    setBusy("analytics");
    setError("");
    setMessage("");

    try {
      const sources = [
        "SHOPIFY_REPORTS",
        ...(availability.ga4 ? ["GA4"] : []),
      ];
      const data = await readJson<{
        ok: true;
        results: Array<{ source: string; rowCount: number }>;
      }>(
        await fetch("/api/collection-rotation/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sources,
            lookbackDays: settings.analyticsLookbackDays,
          }),
        })
      );
      setMessage(
        `Analytics refreshed: ${data.results
          .map((result) => `${result.source} ${result.rowCount} products`)
          .join(" · ")}.`
      );
      setScores([]);
      setPreviewMeta(null);
      setExpandedProductId(null);
      // The data behind any earlier preview just changed, so that seed no
      // longer reflects what a fresh preview would produce.
      if (activeCollectionId) onPreviewSeedChange?.(activeCollectionId, null);
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Analytics sync failed."
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card card-padded rotation-strategy">
      <div className="rotation-section-heading">
        <div>
          <p className="page-header-eyebrow">Ranking engine</p>
          <h3 className="card-title">Choose how products rotate</h3>
          <p className="card-description">
            Preview a weighted order before changing Shopify. Fixed top
            positions always override the score.
          </p>
        </div>
        <label className="rotation-strategy-collection">
          <span className="form-label">Collection to tune</span>
          <select
            className="form-select"
            value={activeCollectionId}
            onChange={(event) => setCollectionId(event.target.value)}
          >
            {orderedCollections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.title} ({collection.productsCount})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rotation-strategy-grid">
        {(
          ["BALANCED", "PERFORMANCE", "DISCOVERY", "RANDOM", "CUSTOM"] as Strategy[]
        ).map((strategy) => (
          <button
            key={strategy}
            type="button"
            className={`rotation-strategy-option ${
              settings.strategy === strategy ? "is-active" : ""
            }`}
            onClick={() => chooseStrategy(strategy)}
          >
            <strong>{STRATEGY_LABELS[strategy]}</strong>
            <span>{STRATEGY_COPY[strategy]}</span>
          </button>
        ))}
      </div>

      <div className="rotation-weight-grid">
        {(
          [
            ["performanceWeight", "Recent performance"],
            ["exposureWeight", "Exposure opportunity"],
            ["freshnessWeight", "Freshness"],
            ["explorationWeight", "Exploration"],
          ] as Array<[keyof Settings, string]>
        ).map(([field, label]) => (
          <label key={field}>
            <span className="form-label">{label}</span>
            <span className="rotation-weight-input">
              <input
                type="number"
                min="0"
                max="100"
                value={settings[field]}
                disabled={settings.strategy !== "CUSTOM"}
                onChange={(event) =>
                  updateWeight(field, Number(event.target.value))
                }
              />
              <span>%</span>
            </span>
          </label>
        ))}
      </div>

      <div className="rotation-data-bar">
        <div>
          <strong>Data window</strong>
          <select
            className="form-select"
            value={settings.analyticsLookbackDays}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                analyticsLookbackDays: Number(event.target.value),
              }))
            }
          >
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <p>
          Shopify sales: ready · GA4 behavior:{" "}
          {availability.ga4 ? "configured" : "not connected"}
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void syncAnalytics()}
          disabled={Boolean(busy)}
        >
          {busy === "analytics" ? "Refreshing..." : "Refresh analytics"}
        </button>
      </div>

      {weightTotal !== 100 ? (
        <p className="rotation-alert rotation-alert-error">
          Custom weights currently total {weightTotal}%. They must total 100%.
        </p>
      ) : null}
      {error ? (
        <p className="rotation-alert rotation-alert-error">{error}</p>
      ) : null}
      {message ? (
        <p className="rotation-alert rotation-alert-success">{message}</p>
      ) : null}

      <div className="rotation-strategy-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={Boolean(busy) || weightTotal !== 100}
          onClick={() => void saveSettings()}
        >
          {busy === "save" ? "Saving..." : "Save strategy"}
        </button>
        <button
          type="button"
          className="button"
          disabled={Boolean(busy) || weightTotal !== 100}
          onClick={() => void buildPreview()}
        >
          {busy === "preview" ? "Building preview..." : "Preview next rotation"}
        </button>
      </div>

      {scores.length > 0 ? (
        <div className="rotation-score-preview">
          <div className="rotation-score-heading">
            <div>
              <h4>Proposed first 12 products</h4>
              <p>
                These are the products customers see first in collection grids
                and featured sliders.
              </p>
            </div>
            <span className={`rotation-confidence is-${previewMeta?.confidence.toLowerCase()}`}>
              {previewMeta?.confidence} data confidence
            </span>
          </div>
          <div className="rotation-score-table-wrap">
            <table className="rotation-score-table">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Product</th>
                  <th>Score</th>
                  <th>Performance</th>
                  <th>Exposure</th>
                  <th>Freshness</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {scores.slice(0, 12).map((score) => {
                  const isExpanded = expandedProductId === score.productId;
                  return (
                    <Fragment key={score.productId}>
                      <tr
                        className={`rotation-score-row${isExpanded ? " is-expanded" : ""}`}
                        onClick={() =>
                          setExpandedProductId((current) =>
                            current === score.productId ? null : score.productId
                          )
                        }
                      >
                        <td>
                          {score.previousPosition} → {score.proposedPosition}
                        </td>
                        <td>
                          <span className="rotation-score-toggle">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                          {score.title}
                          {isConfirmedOutOfStock(score) ? (
                            <span className="rotation-out-of-stock-tag">
                              Out of stock
                            </span>
                          ) : null}
                        </td>
                        <td><strong>{score.score}</strong></td>
                        <td>{score.performance}</td>
                        <td>{score.exposure}</td>
                        <td>{score.freshness}</td>
                        <td>
                          {score.metrics.sources.length > 0
                            ? score.metrics.sources.join(", ")
                            : "Cold start"}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="rotation-score-detail-row">
                          <td colSpan={7}>
                            <ScoreBreakdown score={score} weights={settings} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="rotation-score-note">
            Exposure uses the last {previewMeta?.runHistoryCount ?? 0} saved
            rotations. It measures position opportunity across the infinite
            collection, with extra importance on the first 12—not page views.
          </p>
        </div>
      ) : null}
    </section>
  );
}
