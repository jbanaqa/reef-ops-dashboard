"use client";
import EmailDesigner from "./EmailDesigner";
import {
  render,
  defaultContent,
  type MarketingSettings,
} from "@/lib/marketing/rules";
import { useEffect, useRef, useState } from "react";
import {
  defaultStockConfig,
  stockCopy,
  stockMessageContent,
  stockTokens,
  validateStock,
  type StockConfig,
} from "@/lib/marketing/stock-config";
import { readDraft, writeDraft } from "./flow-drafts";
import { FlowMap, type Node } from "./FlowMap";
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

type StockPanel =
  | "trigger"
  | "recipient"
  | "email"
  | "sms"
  | "rules"
  | "checks";
const panelTitles: Record<StockPanel, string> = {
  trigger: "Stock trigger",
  recipient: "Staff recipient and channels",
  email: "Email alert",
  sms: "Text alert",
  rules: "Repeat-alert rule",
  checks: "Test and check stock",
};
function StockDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="stock-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="stock-dialog-header">
        <h3>{title}</h3>
        <button onClick={close} aria-label="Back to stock flow">
          ✕
        </button>
      </div>
      <div className="stock-dialog-body">{children}</div>
      <div className="stock-dialog-footer">
        <small>Changes stay in your draft. Save the flow to apply them.</small>
        <button onClick={close}>Done</button>
      </div>
    </dialog>
  );
}

export default function LowStockEditor({
  resource,
  busy,
  setup,
  settings,
  save,
}: {
  resource: FlowResource;
  busy: boolean;
  setup: Record<string, unknown>;
  settings: MarketingSettings;
  save: (
    data: Record<string, unknown>,
    enabled: boolean,
  ) => Promise<FlowResource | undefined>;
}) {
  const [panel, setPanel] = useState<StockPanel | null>(null);
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
  let emailContent = defaultContent,
    emailHtml = "",
    emailPreviewError = "";
  try {
    emailContent = stockMessageContent(s, "EMAIL", sample);
    emailHtml = render(
      emailContent,
      "#unsubscribe",
      settings.postalAddress,
      undefined,
      settings.organizationName,
    );
  } catch (e) {
    emailPreviewError = e instanceof Error ? e.message : "Preview unavailable";
  }
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
      return !!result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      return false;
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

  const nodes: Node[] = [
    {
      id: "trigger",
      kind: "trigger",
      label: "Variant stock drops below " + s.threshold,
      detail: "Selected Shopify collection · one alert per stock cycle",
      target: { kind: "info" },
    },
    {
      id: "recipient",
      kind: "condition",
      label: "Notify the staff recipient",
      detail: s.recipientEmail || "Choose a recipient",
      target: { kind: "info" },
    },
    {
      id: "email",
      kind: "email",
      label: "Low stock email",
      detail: s.emailEnabled
        ? "Email · queued immediately"
        : "Email off · click to configure",
      target: { kind: "info" },
    },
    {
      id: "sms",
      kind: "sms",
      label: "Low stock text",
      detail: s.smsEnabled
        ? "Text · independent of email · respects quiet hours"
        : "Text off · click to configure",
      target: { kind: "info" },
    },
    {
      id: "rules",
      kind: "end",
      label: "Wait for stock to recover",
      detail:
        "Another alert after recovery to " +
        s.threshold +
        " or more, then a new drop.",
      target: { kind: "info" },
    },
  ];
  return (
    <article className="mk-panel stock-editor stock-schematic">
      <div className="mk-flow-editor-heading">
        <h2>Edit {resource.name}</h2>
        <span className="mk-flow-editor-hint">Click any step to edit it</span>
      </div>
      <div className="mk-flow-note">
        <strong>How this works</strong>
        <span>
          Follow the timeline from top to bottom. Click a block to view or edit
          its settings.
        </span>
      </div>
      <FlowMap
        resource={resource}
        nodes={nodes}
        onNodeClick={(node) => setPanel(node.id as StockPanel)}
      />
      <div className="stock-diagram-tools">
        <button disabled={!ready} onClick={() => setPanel("checks")}>
          Test and check stock
        </button>
        <small>
          {checkStatus?.at
            ? "Last check: " + new Date(checkStatus.at).toLocaleString()
            : "Preview inventory or run a check using the saved rules."}
        </small>
      </div>
      <p role="status">
        {notice ||
          (dirty
            ? "Changes are kept as a draft in this browser. Save flow to apply them."
            : "Settings match the saved flow.")}
      </p>
      <button
        disabled={busy || !ready}
        onClick={() => {
          if (
            window.confirm(
              "Discard this browser draft and reload the saved stock flow?",
            )
          ) {
            setDraft(initial(resource));
            setError("");
            setNotice("Loaded the saved stock flow.");
          }
        }}
      >
        Discard draft and reload saved flow
      </button>
      {error && !panel && (
        <p role="alert" className="stock-error">
          {error}
        </p>
      )}
      <div className="mk-flow-controls stock-flow-controls">
        {" "}
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
        <button disabled={!ready || busy || checking} onClick={saveFlow}>
          {busy ? "Saving…" : "Save stock flow"}
        </button>
      </div>
      {panel && panel !== "email" && (
        <StockDialog title={panelTitles[panel]} close={() => setPanel(null)}>
          {panel === "trigger" && (
            <div>
              {" "}
              <label>
                Shopify collection ID
                <input
                  value={s.collectionId}
                  onChange={(e) => set("collectionId", e.target.value)}
                />
                <small>
                  Prefilled from your T5 Tank workflow. Find another
                  collection’s ID in its Shopify admin URL.
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
                  With 5, quantities of 4 or fewer qualify. Each variant is
                  checked separately across locations.
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
            </div>
          )}
          {panel === "recipient" && (
            <div>
              {" "}
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
                      <option value="America/New_York">
                        Eastern — New York
                      </option>
                      <option value="Pacific/Honolulu">
                        Hawaii — Honolulu
                      </option>
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
                    Texts wait from 8 p.m. to 11 a.m. in this timezone. Email
                    alerts do not wait for quiet hours.
                  </p>
                  <label className="stock-check">
                    <input
                      type="checkbox"
                      checked={s.smsConsentConfirmed}
                      onChange={(e) =>
                        set("smsConsentConfirmed", e.target.checked)
                      }
                    />{" "}
                    This staff member has agreed to receive operational stock
                    texts at this number.
                  </label>
                  {!setup.smsReady && (
                    <p className="stock-note">
                      Text delivery is not configured yet. Email can run on its
                      own; texts will wait until the SMS gateway is ready.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {panel === "sms" && (
            <div>
              <label className="stock-check">
                <input
                  type="checkbox"
                  checked={s.smsEnabled}
                  onChange={(e) => set("smsEnabled", e.target.checked)}
                />
                Enable this text alert
              </label>
              <p className="stock-help">
                Product details fill in automatically. Keep these fields in your
                copy: {stockTokens.map((t) => "{{ " + t + " }}").join(", ")}.
              </p>
              <div className="stock-grid">
                {panel === "sms" && (
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

              {panel === "sms" && (
                <p className="stock-help">
                  Quiet hours: 8 p.m.–11 a.m. in the recipient’s timezone. Edit
                  the recipient block to change timezone or permission settings.
                </p>
              )}
            </div>
          )}
          {panel === "rules" && (
            <div>
              {" "}
              <p>
                Checks run with the background worker. The first check
                establishes starting quantities without sending old low-stock
                alerts. A restock seen by a later check resets the alert and
                cancels any unsent alert for that variant.
              </p>
              <p className="stock-help">
                Changes that happen entirely between checks may not be seen.
                Changing the collection or threshold starts a new baseline. Turn
                off the old Shopify/Klaviyo stock flow when you switch over to
                avoid duplicate alerts.
              </p>
            </div>
          )}
          {panel === "checks" && (
            <div>
              <p>
                Use the trigger block to preview current inventory without
                creating alerts. This check uses your saved flow settings.
              </p>{" "}
              {!setup.sendingEnabled && (
                <p className="stock-note">
                  Sending is paused in Settings. An enabled flow can queue
                  alerts, but delivery waits until sending is on.
                </p>
              )}
              {!setup.ingestEnabled && (
                <p className="stock-note">
                  Shopify ingestion must be enabled in Settings for automatic
                  stock checks.
                </p>
              )}
              <div className="stock-actions">
                <button
                  disabled={
                    dirty || !resource.enabled || busy || checking || !ready
                  }
                  onClick={processSavedStock}
                >
                  Check saved flow now
                </button>
                <small>
                  Uses your saved rules to establish the baseline or queue new
                  alerts. Delivery happens through the normal worker when
                  sending is on.
                </small>
              </div>
              {checkStatus && (
                <div className="stock-preview" role="status">
                  <strong>Last stock check</strong>
                  {checkStatus.error || checkStatus.skipped ? (
                    <p>{checkStatus.error || checkStatus.skipped}</p>
                  ) : (
                    <p>
                      {checkStatus.collection}: {checkStatus.checked} variants
                      checked · {checkStatus.low} below threshold ·{" "}
                      {checkStatus.queued} messages queued
                    </p>
                  )}
                  {checkStatus.at && (
                    <small>{new Date(checkStatus.at).toLocaleString()}</small>
                  )}
                </div>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="stock-error">
              {error}
            </p>
          )}
        </StockDialog>
      )}

      {panel === "email" && (
        <EmailDesigner
          title="Low stock email"
          subject={s.emailSubject}
          previewSubject={stockCopy(s.emailSubject, sample)}
          content={emailContent}
          html={emailHtml}
          previewError={emailPreviewError}
          previewCaption="Example stock data · Actual product details are filled in when the alert runs."
          busy={busy || checking || !ready}
          status={
            notice ||
            "Changes are kept as a draft in this browser. Save flow to apply them."
          }
          organizationName={settings.organizationName}
          postalAddress={settings.postalAddress}
          onSubject={(value) => set("emailSubject", value)}
          onContent={() => {}}
          onSave={saveFlow}
          onClose={() => setPanel(null)}
          contentFields={
            <>
              <section className="mk-editor-section">
                <h3>Stock email</h3>
                <p>
                  Edit the message here and see the finished email alongside it.
                </p>
                <label className="stock-check">
                  <input
                    type="checkbox"
                    checked={s.emailEnabled}
                    onChange={(e) => set("emailEnabled", e.target.checked)}
                  />
                  Enable this email alert
                </label>
                <label>
                  Subject
                  <input
                    aria-label="Email subject"
                    maxLength={200}
                    value={s.emailSubject}
                    onChange={(e) => set("emailSubject", e.target.value)}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    aria-label="Email message"
                    rows={10}
                    value={s.emailBody}
                    onChange={(e) => set("emailBody", e.target.value)}
                  />
                </label>
                <small>
                  Product name, variant, and quantity fill in automatically. A
                  product button is added below the message.
                </small>
                <details>
                  <summary>Available product fields</summary>
                  <p>{stockTokens.map((t) => "{{ " + t + " }}").join(", ")}</p>
                </details>
                {error && (
                  <p role="alert" className="stock-error">
                    {error}
                  </p>
                )}
              </section>
            </>
          }
        />
      )}
    </article>
  );
}
