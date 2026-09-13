"use client";

import { useEffect, useState } from "react";
import {
  STRATEGY_LABELS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";

type Target = { id: string; title: string; handle: string };
type Weights = {
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
};
type Preset = Weights & { id: string; name: string };
const fields = [
  ["performanceWeight", "Performance", "Products with recent demand"],
  ["exposureWeight", "Exposure", "Products that need more visibility"],
  ["freshnessWeight", "Freshness", "Newer products"],
  ["explorationWeight", "Exploration", "Variety and discovery"],
] as const;
const descriptions: Record<string, string> = {
  BALANCED: "A mix of demand, discovery and freshness.",
  PERFORMANCE: "Give proven products more visibility.",
  DISCOVERY: "Bring newer and overlooked products forward.",
  RANDOM: "Shuffle freely around fixed positions.",
  CUSTOM: "Set your own mix or reuse a saved preset.",
};

export default function BulkStrategyEditor({
  targets,
  onApplied,
}: {
  targets: Target[];
  onApplied: () => void;
}) {
  const [selection, setSelection] = useState("BALANCED");
  const [weights, setWeights] = useState<Weights>({
    performanceWeight: 45,
    exposureWeight: 30,
    freshnessWeight: 15,
    explorationWeight: 10,
  });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  useEffect(() => {
    let active = true;
    fetch("/api/collection-rotation/weight-presets", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new Error(data.error || "Could not load presets.");
        return data;
      })
      .then((data) => {
        if (active) setPresets(data.presets);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function savePreset() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/collection-rotation/weight-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: presetName, ...weights }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Could not save preset.");
      setPresets((current) => [
        ...current.filter((p) => p.id !== data.preset.id),
        data.preset,
      ]);
      setMessage(
        `Saved “${data.preset.name}”. You can now apply these weights to your selection.`,
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save preset.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/collection-rotation/strategy/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: selection,
          ...(selection === "CUSTOM" ? weights : {}),
          collections: targets.map((c) => ({
            collectionId: c.id,
            collectionTitle: c.title,
            collectionHandle: c.handle,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Could not apply strategy.");
      setMessage(
        `Strategy saved to ${data.updatedCount} collection${data.updatedCount === 1 ? "" : "s"}. Product order has not changed yet.`,
      );
      if (data.failed?.length)
        setError(
          data.failed
            .map(
              (f: { collectionId: string; error?: string }) =>
                `${targets.find((c) => c.id === f.collectionId)?.title || f.collectionId}: ${f.error || "Update failed"}`,
            )
            .join(" · "),
        );
      onApplied();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not apply strategy.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cr-bulk-editor">
      <div className="cr-target-summary">
        <span>
          APPLYING TO {targets.length} COLLECTION
          {targets.length === 1 ? "" : "S"}
        </span>
        <p>{targets.map((c) => c.title).join(", ")}</p>
      </div>
      <h3>How should these collections rank?</h3>
      <div className="cr-strategy-choices">
        {Object.entries(descriptions).map(([key, description]) => (
          <button
            key={key}
            type="button"
            disabled={busy}
            aria-pressed={selection === key}
            onClick={() => setSelection(key)}
          >
            <strong>{STRATEGY_LABELS[key as RotationStrategy]}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      {selection === "CUSTOM" && (
        <div className="cr-custom-editor">
          <label className="cr-preset-picker">
            Start from a saved preset
            <select
              className="form-select"
              disabled={busy}
              value={
                presets.find((p) =>
                  fields.every(([key]) => p[key] === weights[key]),
                )?.id ?? ""
              }
              onChange={(event) => {
                const p = presets.find((p) => p.id === event.target.value);
                if (p) {
                  const {
                    performanceWeight,
                    exposureWeight,
                    freshnessWeight,
                    explorationWeight,
                  } = p;
                  setWeights({
                    performanceWeight,
                    exposureWeight,
                    freshnessWeight,
                    explorationWeight,
                  });
                  setPresetName(p.name);
                }
              }}
            >
              <option value="">Choose a preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="cr-weight-meter"
            aria-label={`Weight total ${total}%`}
          >
            {fields.map(([key]) => (
              <span key={key} style={{ flex: weights[key] }} />
            ))}
          </div>
          {fields.map(([key, label, detail]) => (
            <label className="cr-weight-control" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              <input
                aria-label={`${label} weight`}
                type="range"
                min="0"
                max="100"
                disabled={busy}
                value={weights[key]}
                onChange={(e) =>
                  setWeights({ ...weights, [key]: Number(e.target.value) })
                }
              />
              <input
                aria-label={`${label} percent`}
                type="number"
                min="0"
                max="100"
                disabled={busy}
                value={weights[key]}
                onChange={(e) =>
                  setWeights({
                    ...weights,
                    [key]: Math.min(
                      100,
                      Math.max(0, Math.round(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
              <span>%</span>
            </label>
          ))}
          <p className={total === 100 ? "cr-total-valid" : "cr-total-invalid"}>
            {total}% of 100% allocated
            {total !== 100
              ? " — adjust weights to total 100%."
              : " · Ready to apply"}
          </p>
          <details className="cr-save-preset">
            <summary>Save this mix as a reusable preset</summary>
            <label>
              Preset name
              <input
                className="form-input"
                maxLength={60}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </label>
            <p>
              Using an existing name replaces that saved preset. Collections
              keep their current weights until you apply it again.
            </p>
            <button
              className="button button-secondary"
              disabled={busy || !presetName.trim() || total !== 100}
              onClick={() => void savePreset()}
            >
              Save preset
            </button>
          </details>
        </div>
      )}
      {error && (
        <p role="alert" className="rotation-alert rotation-alert-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rotation-alert rotation-alert-success">
          {message}
        </p>
      )}
      <footer className="cr-editor-footer">
        <p>
          This updates the saved strategy. Fixed positions stay in place;
          rotation happens when you run it or at the next scheduled run.
        </p>
        <button
          className="button button-primary"
          disabled={
            busy || !targets.length || (selection === "CUSTOM" && total !== 100)
          }
          onClick={() => void apply()}
        >
          {busy
            ? "Saving…"
            : `Apply strategy to ${targets.length} collection${targets.length === 1 ? "" : "s"}`}
        </button>
      </footer>
    </div>
  );
}
