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

// A named, shop-wide custom weight orientation - saved once from this panel,
// reusable both here (apply to whichever collection is active) and in the
// bulk assignment bar (apply to many collections at once).
type WeightPreset = {
  id: string;
  name: string;
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
  updatedAt: string;
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
  performance: "Units sold and revenue vs. the rest of this collection — built entirely from Shopify Reports data, no page-view tracking required.",
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

function FactorDetail({
  factorKey,
  score,
}: {
  factorKey: "performance" | "exposure" | "freshness" | "exploration";
  score: PreviewScore;
}) {
  if (factorKey === "performance") {
    const performance = score.breakdown.performance;
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
            <span>Revenue</span>
            <strong>{formatCurrency(score.metrics.revenue)}</strong>
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
    outOfStockCount: number;
  } | null>(null);
  // The preview endpoint already returns every product in the collection,
  // scored and sorted by proposed position (i.e. descending overall score) -
  // the top-12 table just slices it. "View all" reuses that same array and
  // paginates it instead of re-fetching anything.
  const [viewAllProducts, setViewAllProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(0);
  const [availability, setAvailability] = useState({
    shopifyReports: true,
    ga4: false,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // Saved weight presets are shop-wide (not per-collection), so they're
  // loaded once on mount rather than every time the active collection
  // changes.
  const [weightPresets, setWeightPresets] = useState<WeightPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetsError, setPresetsError] = useState("");

  const loadWeightPresets = () => {
    fetch("/api/collection-rotation/weight-presets", { cache: "no-store" })
      .then((response) =>
        readJson<{ ok: true; presets: WeightPreset[] }>(response)
      )
      .then((data) => setWeightPresets(data.presets))
      .catch(() => {
        // Non-fatal - the rest of the panel still works without saved
        // presets, so this fails silently rather than blocking the page.
      });
  };

  useEffect(() => {
    loadWeightPresets();
  }, []);

  function applyWeightPreset(preset: WeightPreset) {
    setSettings((current) => ({
      ...current,
      strategy: "CUSTOM",
      performanceWeight: preset.performanceWeight,
      exposureWeight: preset.exposureWeight,
      freshnessWeight: preset.freshnessWeight,
      explorationWeight: preset.explorationWeight,
    }));
    setScores([]);
    setPreviewMeta(null);
    setExpandedProductId(null);
    if (activeCollectionId) onPreviewSeedChange?.(activeCollectionId, null);
  }

  async function saveWeightPreset() {
    const name = presetName.trim();
    if (!name || weightTotal !== 100) return;
    setPresetsError("");

    try {
      const data = await readJson<{ ok: true; preset: WeightPreset }>(
        await fetch("/api/collection-rotation/weight-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            performanceWeight: settings.performanceWeight,
            exposureWeight: settings.exposureWeight,
            freshnessWeight: settings.freshnessWeight,
            explorationWeight: settings.explorationWeight,
          }),
        })
      );
      setWeightPresets((current) => {
        const withoutExisting = current.filter(
          (preset) => preset.id !== data.preset.id
        );
        return [...withoutExisting, data.preset].sort((first, second) =>
          first.name.localeCompare(second.name)
        );
      });
      setPresetName("");
    } catch (saveError) {
      setPresetsError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this orientation."
      );
    }
  }

  async function deleteWeightPreset(preset: WeightPreset) {
    setPresetsError("");
    const previous = weightPresets;
    setWeightPresets((current) =>
      current.filter((item) => item.id !== preset.id)
    );

    try {
      await readJson(
        await fetch(
          `/api/collection-rotation/weight-presets?id=${encodeURIComponent(preset.id)}`,
          { method: "DELETE" }
        )
      );
    } catch (deleteError) {
      setWeightPresets(previous);
      setPresetsError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this orientation."
      );
    }
  }

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
        setViewAllProducts(false);
        setProductSearch("");
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

  const PRODUCTS_PER_PAGE = 25;
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const filteredAllScores =
    viewAllProducts && normalizedProductSearch
      ? scores.filter((score) =>
          score.title.toLowerCase().includes(normalizedProductSearch)
        )
      : scores;
  const totalProductPages = Math.max(
    1,
    Math.ceil(filteredAllScores.length / PRODUCTS_PER_PAGE)
  );
  const safeProductPage = Math.min(productPage, totalProductPages - 1);
  const displayedScores = viewAllProducts
    ? filteredAllScores.slice(
        safeProductPage * PRODUCTS_PER_PAGE,
        safeProductPage * PRODUCTS_PER_PAGE + PRODUCTS_PER_PAGE
      )
    : scores.slice(0, 12);

  // Whenever the underlying score set, the search filter, or the view mode
  // changes, the previously-selected page number may no longer be valid (or
  // may no longer be what the person is looking at) - snap back to page 1.
  useEffect(() => {
    setProductPage(0);
  }, [scores, normalizedProductSearch, viewAllProducts]);

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
          outOfStockCount: number;
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

      <div className="rotation-weight-presets">
        <div className="rotation-weight-presets-heading">
          <strong>Saved custom orientations</strong>
          <span>
            Save the weights above under a name to reuse them later, on this
            collection or several at once from the automation panel.
          </span>
        </div>

        {weightPresets.length > 0 ? (
          <div className="rotation-weight-preset-chips">
            {weightPresets.map((preset) => (
              <div key={preset.id} className="rotation-weight-preset-chip">
                <button
                  type="button"
                  className="rotation-weight-preset-apply"
                  title={`${preset.performanceWeight}/${preset.exposureWeight}/${preset.freshnessWeight}/${preset.explorationWeight} (performance/exposure/freshness/exploration)`}
                  onClick={() => applyWeightPreset(preset)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="rotation-weight-preset-delete"
                  aria-label={`Delete "${preset.name}"`}
                  onClick={() => void deleteWeightPreset(preset)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rotation-weight-presets-empty">
            No saved orientations yet.
          </p>
        )}

        {presetsError ? (
          <p className="rotation-alert rotation-alert-error">{presetsError}</p>
        ) : null}

        <div className="rotation-weight-preset-save">
          <input
            type="text"
            className="form-input"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Name this orientation (e.g. Aggressive clearance)"
            maxLength={60}
            disabled={settings.strategy !== "CUSTOM"}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={
              !presetName.trim() ||
              weightTotal !== 100 ||
              settings.strategy !== "CUSTOM"
            }
            onClick={() => void saveWeightPreset()}
          >
            Save as preset
          </button>
        </div>
        {settings.strategy !== "CUSTOM" ? (
          <p className="rotation-weight-presets-empty">
            Switch to Custom above to save the current weights as a new
            preset.
          </p>
        ) : null}
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
              <h4>
                {viewAllProducts
                  ? `All ${scores.length} in-stock product${scores.length === 1 ? "" : "s"}, ranked by overall score`
                  : "Proposed first 12 products"}
              </h4>
              <p>
                {viewAllProducts
                  ? "Every in-stock product in this collection with its full score breakdown, sorted highest to lowest — exactly the order the next shuffle would apply."
                  : "These are the products customers see first in collection grids and featured sliders."}
              </p>
            </div>
            <span className={`rotation-confidence is-${previewMeta?.confidence.toLowerCase()}`}>
              {previewMeta?.confidence} data confidence
            </span>
          </div>

          {previewMeta && previewMeta.outOfStockCount > 0 ? (
            <p className="rotation-score-detail-note rotation-out-of-stock-note rotation-score-oos-summary">
              {previewMeta.outOfStockCount} out-of-stock product
              {previewMeta.outOfStockCount === 1 ? "" : "s"} excluded from
              scoring — Shopify wouldn&apos;t show or sell them in a top slot
              anyway, so they&apos;re left out of the ranking entirely and
              moved to the end of the collection instead.
            </p>
          ) : null}

          <div className="rotation-score-view-controls">
            <div className="rotation-score-view-toggle">
              <button
                type="button"
                className={`rotation-score-view-option${viewAllProducts ? "" : " is-active"}`}
                onClick={() => setViewAllProducts(false)}
              >
                Top 12
              </button>
              <button
                type="button"
                className={`rotation-score-view-option${viewAllProducts ? " is-active" : ""}`}
                onClick={() => setViewAllProducts(true)}
              >
                View all products
              </button>
            </div>
            {viewAllProducts ? (
              <input
                type="search"
                className="form-input rotation-score-search"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Search by product title"
              />
            ) : null}
          </div>

          <div className="rotation-score-table-wrap">
            <table className="rotation-score-table">
              <thead>
                <tr>
                  <th>{viewAllProducts ? "Rank" : "Move"}</th>
                  <th>Product</th>
                  <th>Score</th>
                  <th>Performance</th>
                  <th>Exposure</th>
                  <th>Freshness</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {displayedScores.map((score) => {
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
                          {viewAllProducts
                            ? score.proposedPosition
                            : `${score.previousPosition} → ${score.proposedPosition}`}
                        </td>
                        <td>
                          <span className="rotation-score-toggle">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                          {score.title}
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
                {viewAllProducts && displayedScores.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="rotation-score-empty-cell">
                      No products match &ldquo;{productSearch}&rdquo;.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {viewAllProducts ? (
            <div className="rotation-score-pagination">
              <button
                type="button"
                className="button button-secondary"
                disabled={safeProductPage === 0}
                onClick={() =>
                  setProductPage((current) => Math.max(0, current - 1))
                }
              >
                Previous
              </button>
              <span>
                Page {safeProductPage + 1} of {totalProductPages}
                {" · "}
                {filteredAllScores.length} product
                {filteredAllScores.length === 1 ? "" : "s"}
                {normalizedProductSearch ? " matched" : " total"}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={safeProductPage >= totalProductPages - 1}
                onClick={() =>
                  setProductPage((current) =>
                    Math.min(totalProductPages - 1, current + 1)
                  )
                }
              >
                Next
              </button>
            </div>
          ) : null}

          <p className="rotation-score-note">
            Exposure uses the full history of{" "}
            {previewMeta?.runHistoryCount ?? 0} saved rotation
            {previewMeta?.runHistoryCount === 1 ? "" : "s"} for this
            collection - not just a recent slice. It measures position
            opportunity across the infinite collection, with extra
            importance on the first 12—not page views.
          </p>
        </div>
      ) : null}
    </section>
  );
}
