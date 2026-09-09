"use client";
import { useEffect, useRef, useState } from "react";
import {
  defaultStockConfig,
  stockCopy,
  stockTokens,
  validateStock,
  type StockConfig,
} from "@/lib/marketing/stock-config";
import { readDraft, writeDraft } from "./flow-drafts";
import type { FlowResource } from "./FlowsWorkspace";
type Draft = { stock: StockConfig; reviewed: boolean; enabled: boolean };
type CheckStatus = {
  at?: string;
  collection?: string;
  checked?: number;
  low?: number;
  queued?: number;
  error?: string;
  skipped?: string;
};
type Preview = {
  collection: string;
  checked: number;
  low: number;
  at: string;
  variants: {
    id: string;
    product: string;
    variant: string;
    quantity: number;
  }[];
};
const initial = (r: FlowResource): Draft => ({
  stock: {
    ...defaultStockConfig,
    ...((r.data.stock as Partial<StockConfig>) || {}),
  },
  reviewed: !!r.data.stock && r.data.reviewed === true,
  enabled: !!r.data.stock && r.enabled,
});
export default function LowStockEditor({
  resource,
  busy,
  setup,
  save,
}: {
  resource: FlowResource;
  busy: boolean;
  setup: Record<string, unknown>;
  save: (
    data: Record<string, unknown>,
    enabled: boolean,
  ) => Promise<FlowResource | undefined>;
}) {
  const [draft, setDraft] = useState<Draft>(() => initial(resource));
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState<CheckStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketing?view=stock-status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (r) setCheckStatus((current) => current ?? r.status);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const key = "stock-v2:" + resource.id;
  const base = JSON.stringify(initial(resource));
  const current = useRef(draft);
  useEffect(() => {
    current.current = draft;
  }, [draft]);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    readDraft<{ draft: Draft; base: string }>(key)
      .then((saved) => {
        if (!active) return;
        if (saved && JSON.stringify(saved.draft) !== saved.base) {
          setDraft(saved.draft);
          setNotice(
            saved.base === base
              ? "Unfinished changes restored."
              : "Unfinished changes restored. The saved flow also changed; review before saving.",
          );
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setNotice(
            "Browser draft storage is unavailable. Save before leaving.",
          );
        }
      });
    return () => {
      active = false;
    };
    // Restore once; refreshes must not replace typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    writes.current = writes.current
      .catch(() => {})
      .then(() => writeDraft(key, { draft, base }))
      .catch(() => setNotice("Draft storage failed. Save before leaving."));
  }, [draft, base, key, ready]);
  const dirty = JSON.stringify(draft) !== base;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const s = draft.stock;
  const set = <K extends keyof StockConfig>(field: K, value: StockConfig[K]) =>
    setDraft((d) => ({ ...d, stock: { ...d.stock, [field]: value } }));
  const sample = {
    ProductTitle: "Example coral",
    VariantTitle: "Small",
    InventoryQuantity: "4",
    ProductURL: "https://coralsanonymous.com/products/example",
  };
  async function saveFlow() {
    setError("");
    setNotice("");
    const submitted = JSON.stringify(draft);
    try {
      const stock = validateStock(s, draft.enabled);
      if (draft.enabled && !draft.reviewed)
        throw new Error("Review the alert rules before enabling.");
      const result = await save(
        { ...resource.data, stock, reviewed: draft.reviewed },
        draft.enabled,
      );
      if (result && JSON.stringify(current.current) === submitted) {
        setDraft(initial(result));
        setNotice("Stock alert settings saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  }
  async function check() {
    setError("");
    setChecking(true);
    setPreview(null);
    const config = JSON.stringify(s);
    try {
      validateStock(s);
      const response = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview-stock", stock: s }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Stock check failed.");
      setPreview(result);
      setPreviewFor(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stock check failed.");
    } finally {
      setChecking(false);
    }
  }
  async function processSavedStock() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-stock" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Stock check failed.");
      setCheckStatus(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stock check failed.");
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="stock-editor" aria-label="Stock alert settings">
      <div className="stock-summary">
        <strong>
          Below {s.threshold || 5} → notify the team → wait for restock
        </strong>
        <p>
          One alert per variant when a stock check sees it drop below the
          threshold. Another alert is allowed only after a check sees stock
          recover to the threshold or higher.
        </p>
      </div>
      {!resource.data.stock && (
        <p className="stock-note">
          Your T5 settings are prefilled for review. Save them before using this
          flow.
        </p>
      )}
      <div className="stock-grid">
        <section className="mk-panel">
          <h3>1. What to watch</h3>
          <label>
            Shopify collection ID
            <input
              value={s.collectionId}
              onChange={(e) => set("collectionId", e.target.value)}
            />
            <small>
              Prefilled from your T5 Tank workflow. Find another collection’s ID
              in its Shopify admin URL.
            </small>
          </label>
          <label>
            Alert when stock is below
            <input
              type="number"
              min="1"
              max="1000000"
              value={s.threshold}
              onChange={(e) => set("threshold", Number(e.target.value))}
            />
            <small>
              With 5, quantities of 4 or fewer qualify. Each variant is checked
              separately across locations.
            </small>
          </label>
          <button disabled={!ready || checking || busy} onClick={check}>
            {checking ? "Checking Shopify…" : "Preview current stock"}
          </button>
          <small className="stock-help">
            Reads Shopify only. No alerts are created or sent.
          </small>
          {preview && previewFor === JSON.stringify(s) && (
            <div className="stock-preview" aria-live="polite">
              <strong>{preview.collection}</strong>
              <p>
                {preview.checked} tracked variants · {preview.low} below
                threshold
              </p>
              {preview.variants.length > 0 && (
                <ul>
                  {preview.variants.map((v) => (
                    <li key={v.id}>
                      <span>
                        {v.product} · {v.variant}
                      </span>
                      <strong>{v.quantity} left</strong>
                    </li>
                  ))}
                </ul>
              )}
              {preview.low > 50 && (
                <small>Showing the first 50 low-stock variants.</small>
              )}
              <small>Checked {new Date(preview.at).toLocaleString()}</small>
            </div>
          )}
        </section>
        <section className="mk-panel">
          <h3>2. Who gets notified</h3>
          <label>
            Staff email
            <input
              type="email"
              value={s.recipientEmail}
              onChange={(e) => set("recipientEmail", e.target.value)}
            />
          </label>
          <div className="stock-channels">
            <label>
              <input
                type="checkbox"
                checked={s.emailEnabled}
                onChange={(e) => set("emailEnabled", e.target.checked)}
              />{" "}
              Email alert
            </label>
            <label>
              <input
                type="checkbox"
                checked={s.smsEnabled}
                onChange={(e) => set("smsEnabled", e.target.checked)}
              />{" "}
              Text alert
            </label>
          </div>
          {s.smsEnabled && (
            <>
              <label>
                Mobile number
                <input
                  type="tel"
                  value={s.recipientPhone}
                  placeholder="+1 657 345 0924"
                  onChange={(e) => {
                    set("recipientPhone", e.target.value);
                    set("smsConsentConfirmed", false);
                  }}
                />
              </label>
              <label>
                Recipient timezone
                <select
                  aria-label="Recipient timezone"
                  value={s.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                >
                  <option value="">Choose timezone</option>
                  <option value="America/Los_Angeles">
                    Pacific — Los Angeles
                  </option>
                  <option value="America/Denver">Mountain — Denver</option>
                  <option value="America/Phoenix">Arizona — Phoenix</option>
                  <option value="America/Chicago">Central — Chicago</option>
                  <option value="America/New_York">Eastern — New York</option>
                  <option value="Pacific/Honolulu">Hawaii — Honolulu</option>
                  {s.timezone &&
                    ![
                      "America/Los_Angeles",
                      "America/Denver",
                      "America/Phoenix",
                      "America/Chicago",
                      "America/New_York",
                      "Pacific/Honolulu",
                    ].includes(s.timezone) && <option>{s.timezone}</option>}
                </select>
              </label>
              <p className="stock-help">
                Texts wait from 8 p.m. to 11 a.m. in this timezone. Email alerts
                do not wait for quiet hours.
              </p>
              <label className="stock-check">
                <input
                  type="checkbox"
                  checked={s.smsConsentConfirmed}
                  onChange={(e) => set("smsConsentConfirmed", e.target.checked)}
                />{" "}
                This staff member has agreed to receive operational stock texts
                at this number.
              </label>
              {!setup.smsReady && (
                <p className="stock-note">
                  Text delivery is not configured yet. Email can run on its own;
                  texts will wait until the SMS gateway is ready.
                </p>
              )}
            </>
          )}
        </section>
      </div>
      <section className="mk-panel">
        <h3>3. Alert messages</h3>
        <p className="stock-help">
          Product details fill in automatically. Keep these fields in your copy:{" "}
          {stockTokens.map((t) => "{{ " + t + " }}").join(", ")}.
        </p>
        <div className="stock-grid">
          {s.emailEnabled && (
            <div>
              <label>
                Email subject
                <input
                  maxLength={200}
                  aria-label="Email subject"
                  value={s.emailSubject}
                  onChange={(e) => set("emailSubject", e.target.value)}
                />
              </label>
              <label>
                Email message
                <textarea
                  rows={8}
                  aria-label="Email message"
                  value={s.emailBody}
                  onChange={(e) => set("emailBody", e.target.value)}
                />
              </label>
              <details>
                <summary>See example email copy</summary>
                <div className="stock-copy">
                  <strong>{stockCopy(s.emailSubject, sample)}</strong>
                  <p>{stockCopy(s.emailBody, sample)}</p>
                  <span>View product →</span>
                </div>
              </details>
            </div>
          )}
          {s.smsEnabled && (
            <div>
              <label>
                Text message
                <textarea
                  rows={6}
                  aria-label="Text message"
                  value={s.smsBody}
                  onChange={(e) => set("smsBody", e.target.value)}
                />
              </label>
              <details>
                <summary>See example text</summary>
                <p className="stock-copy">
                  Corals Anonymous: {stockCopy(s.smsBody, sample)}{" "}
                  {sample.ProductURL}
                </p>
              </details>
            </div>
          )}
        </div>
        <p className="stock-help">
          A product link is added to both alerts automatically.
        </p>
      </section>
      <section className="mk-panel">
        <h3>4. Review and enable</h3>
        <p>
          Checks run with the background worker. The first check establishes
          starting quantities without sending old low-stock alerts. A restock
          seen by a later check resets the alert and cancels any unsent alert
          for that variant.
        </p>
        <p className="stock-help">
          Changes that happen entirely between checks may not be seen. Changing
          the collection or threshold starts a new baseline. Turn off the old
          Shopify/Klaviyo stock flow when you switch over to avoid duplicate
          alerts.
        </p>
        <label className="stock-check">
          <input
            type="checkbox"
            checked={draft.reviewed}
            onChange={(e) =>
              setDraft((d) => ({ ...d, reviewed: e.target.checked }))
            }
          />{" "}
          I reviewed the collection, recipient, messages, and repeat-alert rule.
        </label>
        <label className="stock-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, enabled: e.target.checked }))
            }
          />{" "}
          Enable this stock flow
        </label>
        {!setup.sendingEnabled && (
          <p className="stock-note">
            Sending is paused in Settings. An enabled flow can queue alerts, but
            delivery waits until sending is on.
          </p>
        )}
        {!setup.ingestEnabled && (
          <p className="stock-note">
            Shopify ingestion must be enabled in Settings for automatic stock
            checks.
          </p>
        )}
        {error && (
          <p role="alert" className="stock-error">
            {error}
          </p>
        )}
        <p role="status">
          {notice ||
            (dirty
              ? "Changes are saved as a browser draft. Save to apply them."
              : "Settings match the saved flow.")}
        </p>
        <div className="stock-actions">
          <button
            disabled={dirty || !resource.enabled || busy || checking || !ready}
            onClick={processSavedStock}
          >
            Check saved flow now
          </button>
          <small>
            Uses your saved rules to establish the baseline or queue new alerts.
            Delivery happens through the normal worker when sending is on.
          </small>
        </div>
        {checkStatus && (
          <div className="stock-preview" role="status">
            <strong>Last stock check</strong>
            {checkStatus.error || checkStatus.skipped ? (
              <p>{checkStatus.error || checkStatus.skipped}</p>
            ) : (
              <p>
                {checkStatus.collection}: {checkStatus.checked} variants checked
                · {checkStatus.low} below threshold · {checkStatus.queued}{" "}
                messages queued
              </p>
            )}
            {checkStatus.at && (
              <small>{new Date(checkStatus.at).toLocaleString()}</small>
            )}
          </div>
        )}
        <button
          className="mk-primary"
          disabled={!ready || busy || checking}
          onClick={saveFlow}
        >
          {busy ? "Saving…" : "Save stock flow"}
        </button>
      </section>
    </div>
  );
}
