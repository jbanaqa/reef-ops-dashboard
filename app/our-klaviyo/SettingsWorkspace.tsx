"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  MarketingOperations,
  MarketingSettings,
} from "@/lib/marketing/rules";

type InboxRow = {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
};
type ImportResult = { row: number; status: string; error?: string };
type ConnectionResult = {
  results: { topic: string; status: string; message?: string }[];
};
export type SettingsData = {
  settings: MarketingSettings;
  setup: Record<string, unknown>;
  health?: {
    unresolved: number;
    inbox: InboxRow[];
    oldestPending: { dueAt: string; error: string | null } | null;
  };
  resources: { kind: string; key: string; data: Record<string, unknown> }[];
  messageCounts: { status: string; _count: number }[];
};
type Patch = Partial<Omit<MarketingSettings, "operations">> & {
  operations?: Partial<MarketingOperations>;
};
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "No run recorded yet";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
async function action<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/marketing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Could not complete this action. Please try again.",
    );
  return data;
}
function Tag({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span className={"sw-tag " + (active ? "active" : "")}>{children}</span>
  );
}
function Toggle({
  label,
  text,
  checked,
  change,
  disabled,
}: {
  label: string;
  text: string;
  checked: boolean;
  change: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="sw-toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{text}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => change(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}
const sections = [
  { key: "overview", name: "Overview", hint: "Status and quick actions" },
  {
    key: "sending",
    name: "Sending & signup",
    hint: "Control customer messages",
  },
  { key: "business", name: "Business details", hint: "Name and email footer" },
  { key: "advanced", name: "Advanced", hint: "Connections and migration" },
];
export default function SettingsWorkspace({
  data,
  refresh,
}: {
  data: SettingsData;
  refresh: () => Promise<void>;
}) {
  const [section, setSection] = useState("overview");
  const [saved, setSaved] = useState(data.settings);
  const [business, setBusiness] = useState({
    organizationName: data.settings.organizationName,
    postalAddress: data.settings.postalAddress,
  });
  const [sending, setSending] = useState(
    data.settings.operations.sendingEnabled,
  );
  const [signup, setSignup] = useState(data.settings.operations.formEnabled);
  const [sync, setSync] = useState(data.settings.operations.ingestEnabled);
  const [migration, setMigration] = useState(
    data.settings.operations.migrationConfirmed,
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [connections, setConnections] = useState<ConnectionResult | null>(null);
  const [importText, setImportText] = useState("");
  const [validated, setValidated] = useState("");
  const [importResults, setImportResults] = useState<ImportResult[] | null>(
    null,
  );
  const [imported, setImported] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const businessDirty = !same(business, {
    organizationName: saved.organizationName,
    postalAddress: saved.postalAddress,
  });
  const sendingDirty =
    sending !== saved.operations.sendingEnabled ||
    signup !== saved.operations.formEnabled;
  const syncDirty = sync !== saved.operations.ingestEnabled;
  const migrationDirty = migration !== saved.operations.migrationConfirmed;
  const dirty = businessDirty || sendingDirty || syncDirty || migrationDirty;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);
  const setup = data.setup;
  const deployment = (setup.deployment || {}) as Partial<MarketingOperations>;
  const worker = data.resources.find(
    (r) => r.kind === "SYSTEM" && r.key === "worker",
  )?.data;
  const pending = data.messageCounts
    .filter((m) => m.status === "PENDING")
    .reduce((n, m) => n + m._count, 0);
  function navigate(key: string) {
    setSection(key);
    setError("");
    setNotice("");
    setReview(false);
  }
  async function run<T>(
    key: string,
    task: () => Promise<T>,
    message: (result: T) => string,
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await task();
      setNotice(message(result));
      try {
        if (key !== "refresh") await refresh();
      } catch {
        setError(
          "Your action completed, but status could not refresh. Refresh status to check the latest results.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy("");
      feedback.current?.focus();
    }
  }
  function save(key: string, patch: Patch, done: () => void) {
    return run(
      key,
      async () => {
        const result = await action<{ settings: MarketingSettings }>({
          action: "save-settings",
          settings: patch,
        });
        setSaved(result.settings);
        done();
        return result;
      },
      () => "Changes saved.",
    );
  }
  function sendSave() {
    return save(
      "sending",
      { operations: { sendingEnabled: sending, formEnabled: signup } },
      () => setReview(false),
    );
  }
  function updateImport(text: string) {
    setImportText(text);
    setValidated("");
    setImportResults(null);
    setImported(false);
  }
  function importRows() {
    const rows: unknown = JSON.parse(importText);
    if (!Array.isArray(rows) || !rows.length || rows.length > 500)
      throw new Error("Choose a prepared file containing 1–500 contacts.");
    return rows;
  }
  const navDirty = (key: string) =>
    key === "overview"
      ? syncDirty
      : key === "sending"
        ? sendingDirty
        : key === "business"
          ? businessDirty
          : migrationDirty;
  return (
    <div className="sw-workspace">
      <nav className="sw-nav" aria-label="Settings sections">
        {sections.map((s) => (
          <button
            key={s.key}
            aria-current={section === s.key ? "page" : undefined}
            onClick={() => navigate(s.key)}
          >
            <span>
              {s.name}
              {navDirty(s.key) && <i aria-label="Unsaved changes">•</i>}
            </span>
            <small>{s.hint}</small>
          </button>
        ))}
        <p>Changes are saved separately in each section.</p>
      </nav>
      <div className="sw-content">
        <div ref={feedback} tabIndex={-1} className="sw-feedback">
          {error && (
            <p className="sw-alert" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="sw-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        {section === "overview" && (
          <>
            <div className="sw-heading">
              <div>
                <p className="sw-eyebrow">WORKSPACE STATUS</p>
                <h2>Your email workspace</h2>
                <p>
                  Check what is active and keep customer details up to date.
                </p>
              </div>
              <button
                disabled={!!busy}
                onClick={() =>
                  run("refresh", refresh, () => "Status refreshed.")
                }
              >
                {busy === "refresh" ? "Refreshing…" : "Refresh status"}
              </button>
            </div>
            <div className="sw-status-grid">
              <article>
                <span>Email setup</span>
                <Tag active={!!setup.emailReady}>
                  {setup.emailReady ? "Configured" : "Needs setup"}
                </Tag>
                <p>
                  {setup.emailReady
                    ? "Required email configuration is present."
                    : "Review sender details and deployment settings."}
                </p>
              </article>
              <article>
                <span>Shopify processing</span>
                <Tag active={!!setup.ingestEnabled}>
                  {setup.ingestEnabled ? "Enabled" : "Paused"}
                </Tag>
                <p>Controls whether received customer events are processed.</p>
              </article>
              <article>
                <span>Customer sending</span>
                <Tag active={!!setup.sendingEnabled}>
                  {setup.sendingEnabled ? "Enabled" : "Paused"}
                </Tag>
                <p>
                  {setup.sendingEnabled
                    ? "Consent, setup, and workflow checks still apply."
                    : "Internal email previews remain available."}
                </p>
              </article>
            </div>
            <section className="sw-card">
              <div className="sw-card-title">
                <div>
                  <h3>Update Shopify customers</h3>
                  <p>
                    Bring received customer changes, tags, and subscriptions
                    into Reef Ops.
                  </p>
                </div>
              </div>
              <div className="sw-sync-action">
                <div>
                  <strong>Process Shopify events now</strong>
                  <p>
                    Run immediately instead of waiting for the scheduled check.
                    This action does not send messages.
                  </p>
                </div>
                <button
                  className="sw-primary"
                  disabled={!!busy || !setup.ingestEnabled}
                  onClick={() =>
                    run(
                      "sync",
                      () =>
                        action<{ processed: number; unresolved: number }>({
                          action: "process-inbox",
                        }),
                      (r) =>
                        "Processed " +
                        r.processed +
                        " events. " +
                        r.unresolved +
                        " unresolved events remain.",
                    )
                  }
                >
                  {busy === "sync"
                    ? "Processing…"
                    : "Process Shopify events now"}
                </button>
              </div>
              <div className="sw-stat-line">
                <div>
                  <span>Last scheduled run</span>
                  <strong>{date(worker?.at)}</strong>
                </div>
                <div>
                  <span>Unresolved events</span>
                  <strong>
                    {data.health ? data.health.unresolved : "Not available"}
                  </strong>
                </div>
              </div>
              <p className="sw-hint">
                Scheduled checks run about every five minutes. Processing events
                updates profiles and may schedule workflow messages; customer
                sending is controlled separately.
              </p>
              <Toggle
                label="Process incoming Shopify events"
                text="Keep this on while testing tags and subscriptions, even when sending is paused."
                checked={sync}
                change={setSync}
                disabled={!!busy}
              />
              {sync && deployment.ingestEnabled === false && (
                <p className="sw-warning">
                  Shopify processing is disabled in the deployment. An
                  administrator must enable it there too.
                </p>
              )}
              <div className="sw-save-row">
                <span>
                  {syncDirty ? "Unsaved sync change" : "Sync preference saved"}
                </span>
                <button
                  disabled={!!busy || !syncDirty}
                  onClick={() =>
                    save(
                      "sync-setting",
                      { operations: { ingestEnabled: sync } },
                      () => {},
                    )
                  }
                >
                  {busy === "sync-setting" ? "Saving…" : "Save sync preference"}
                </button>
              </div>
            </section>
            <section className="sw-card">
              <h3>Delivery health</h3>
              {data.health ? (
                data.health.unresolved ? (
                  <>
                    <p className="sw-warning">
                      {data.health.unresolved} Shopify events still need
                      processing. Customer sending waits until they are
                      resolved.
                    </p>
                    {data.health.inbox.map((row) => (
                      <div className="sw-issue" key={row.id}>
                        <div>
                          <strong>
                            {row.status === "FAILED"
                              ? "Event needs attention"
                              : row.status === "PROCESSING"
                                ? "Event processing"
                                : "Event waiting"}
                          </strong>
                          <small>
                            {date(row.createdAt)} · {row.attempts} attempts
                          </small>
                          {row.error && <p>{row.error}</p>}
                          <details>
                            <summary>Technical details</summary>
                            <code>{row.topic}</code>
                          </details>
                        </div>
                        <button
                          disabled={!!busy || row.status === "PROCESSING"}
                          onClick={() =>
                            run(
                              "retry:" + row.id,
                              () =>
                                action({ action: "retry-inbox", id: row.id }),
                              () =>
                                "Event queued for retry. Use Process Shopify events now to run it.",
                            )
                          }
                        >
                          Queue retry
                        </button>
                      </div>
                    ))}
                    {data.health.unresolved > data.health.inbox.length && (
                      <p>
                        Showing the oldest {data.health.inbox.length} unresolved
                        events.
                      </p>
                    )}
                    <p className="sw-hint">
                      Fix the reported problem before retrying a failed event.
                    </p>
                  </>
                ) : (
                  <p className="sw-health-good">
                    No unresolved Shopify events.
                  </p>
                )
              ) : (
                <p>
                  Delivery health is unavailable. Refresh status to try again.
                </p>
              )}
              <div className="sw-stat-line">
                <div>
                  <span>Pending messages</span>
                  <strong>{pending.toLocaleString()}</strong>
                </div>
                {data.health?.oldestPending && (
                  <div>
                    <span>Oldest scheduled message</span>
                    <strong>{date(data.health.oldestPending.dueAt)}</strong>
                  </div>
                )}
              </div>
              {data.health?.oldestPending?.error && (
                <p className="sw-warning">{data.health.oldestPending.error}</p>
              )}
              <div className="sw-sync-action">
                <div>
                  <strong>Run scheduled delivery now</strong>
                  <p>
                    Send messages that are due using the normal subscription and
                    workflow checks. This applies to all eligible customers and
                    campaigns, not only your test account. Future scheduled
                    times are kept.
                  </p>
                </div>
                <button
                  className="sw-primary"
                  disabled={
                    !!busy ||
                    !setup.sendingEnabled ||
                    !setup.emailReady ||
                    !setup.migrationConfirmed
                  }
                  onClick={() =>
                    run(
                      "delivery",
                      () =>
                        action<{
                          sent?: number;
                          inspected?: number;
                          skipped?: string;
                        }>({ action: "run-delivery" }),
                      (result) =>
                        result.skipped
                          ? "Delivery did not run: " + result.skipped
                          : "Delivery run complete. " +
                            (result.sent || 0) +
                            " messages sent; " +
                            (result.inspected || 0) +
                            " checked. Review message history for any messages still waiting or not sent.",
                    )
                  }
                >
                  {busy === "delivery"
                    ? "Running delivery…"
                    : "Run delivery now"}
                </button>
              </div>
              {(!setup.sendingEnabled ||
                !setup.emailReady ||
                !setup.migrationConfirmed) && (
                <p className="sw-hint">
                  Complete the sending checks and save your sending preferences
                  before running delivery.{" "}
                  <button onClick={() => navigate("sending")}>
                    Review sending settings
                  </button>
                </p>
              )}
              <Link href="/our-klaviyo/audiences">
                View customer activity →
              </Link>
            </section>
          </>
        )}
        {section === "sending" && (
          <>
            <div className="sw-heading">
              <div>
                <p className="sw-eyebrow">MESSAGING CONTROLS</p>
                <h2>Sending & signup</h2>
                <p>Choose when workflows can reach your customers.</p>
              </div>
            </div>
            <section className="sw-card">
              <h3>Customer messages</h3>
              <Toggle
                label="Allow customer sending"
                text="Allows eligible campaigns and workflows to send email and configured text messages. Leave off during setup and enrollment testing."
                checked={sending}
                change={(v) => {
                  setSending(v);
                  setReview(false);
                }}
                disabled={!!busy}
              />
              <p className="sw-hint">
                This applies to all eligible customers, not just your internal
                test address. Turning it off does not cancel messages already
                being sent.
              </p>
              <h4>Before sending can run</h4>
              <ul className="sw-checklist">
                <li>
                  <Tag active={!!setup.emailReady}>
                    {setup.emailReady ? "Configured" : "Needs setup"}
                  </Tag>
                  Email configuration and business address
                </li>
                <li>
                  <Tag active={!!setup.migrationConfirmed}>
                    {setup.migrationConfirmed ? "Confirmed" : "Not confirmed"}
                  </Tag>
                  Subscriber and unsubscribe history reviewed
                </li>
                <li>
                  <Tag active={data.health?.unresolved === 0}>
                    {data.health
                      ? data.health.unresolved === 0
                        ? "Clear"
                        : "Waiting"
                      : "Unknown"}
                  </Tag>
                  Shopify events processed
                </li>
              </ul>
              {sending && deployment.sendingEnabled === false && (
                <p className="sw-warning">
                  Sending is disabled in the deployment. Saving this preference
                  alone will not turn it on.
                </p>
              )}
              <Toggle
                label="Show storefront signup form"
                text="Allows the installed storefront signup form to collect subscriptions. The form also requires its connection and confirmation-email setup."
                checked={signup}
                change={(v) => {
                  setSignup(v);
                  setReview(false);
                }}
                disabled={!!busy}
              />
              {signup && deployment.formEnabled === false && (
                <p className="sw-warning">
                  The signup form is disabled in the deployment.
                </p>
              )}
              <div className="sw-save-row">
                <span>
                  {sendingDirty
                    ? "Unsaved sending changes"
                    : "Sending preferences saved"}
                </span>
                <button
                  className="sw-primary"
                  disabled={!!busy || !sendingDirty}
                  onClick={() => {
                    if (sending && !saved.operations.sendingEnabled)
                      setReview(true);
                    else void sendSave();
                  }}
                >
                  {busy === "sending" ? "Saving…" : "Save sending preferences"}
                </button>
              </div>
              {review && (
                <div ref={reviewRef} tabIndex={-1} className="sw-confirm">
                  <h4>Enable customer sending?</h4>
                  <p>
                    There are currently {pending} pending messages. Eligible
                    queued messages and scheduled campaigns may begin sending on
                    the next run. Internal test-recipient restrictions do not
                    apply here.
                  </p>
                  <div>
                    <button
                      className="sw-primary"
                      disabled={!!busy}
                      onClick={() => void sendSave()}
                    >
                      Confirm sending preference
                    </button>
                    <button disabled={!!busy} onClick={() => setReview(false)}>
                      Keep reviewing
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
        {section === "business" && (
          <>
            <div className="sw-heading">
              <div>
                <p className="sw-eyebrow">CUSTOMER-FACING DETAILS</p>
                <h2>Business details</h2>
                <p>The business information shown in your email footer.</p>
              </div>
            </div>
            <section className="sw-card">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(
                    "business",
                    {
                      organizationName: business.organizationName.trim(),
                      postalAddress: business.postalAddress.trim(),
                    },
                    () =>
                      setBusiness({
                        organizationName: business.organizationName.trim(),
                        postalAddress: business.postalAddress.trim(),
                      }),
                  );
                }}
              >
                <fieldset disabled={!!busy}>
                  <label>
                    Business name
                    <input
                      required
                      maxLength={120}
                      value={business.organizationName}
                      onChange={(e) =>
                        setBusiness((b) => ({
                          ...b,
                          organizationName: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Business mailing address
                    <textarea
                      aria-label="Business mailing address"
                      required
                      maxLength={500}
                      rows={3}
                      value={business.postalAddress}
                      placeholder="Street address, city, state, postal code, country"
                      onChange={(e) =>
                        setBusiness((b) => ({
                          ...b,
                          postalAddress: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <p className="sw-hint">
                    Use a valid business mailing address. These details appear
                    in previews and future sends. Footer copy and artwork are
                    edited within each email.
                  </p>
                  <div className="sw-footer-preview">
                    <span>FOOTER DETAILS PREVIEW</span>
                    <strong>
                      {business.organizationName || "Your business name"}
                    </strong>
                    <p>{business.postalAddress || "Your mailing address"}</p>
                    <span>Unsubscribe</span>
                  </div>
                  <div className="sw-save-row">
                    <span>
                      {businessDirty
                        ? "Unsaved business details"
                        : "Business details saved"}
                    </span>
                    <button
                      className="sw-primary"
                      disabled={
                        !businessDirty ||
                        !business.organizationName.trim() ||
                        !business.postalAddress.trim()
                      }
                    >
                      {busy === "business"
                        ? "Saving…"
                        : "Save business details"}
                    </button>
                  </div>
                </fieldset>
              </form>
            </section>
            <section className="sw-card">
              <h3>Sending address</h3>
              <p>
                Configured by your administrator. The business name above
                changes the footer, not this From address.
              </p>
              <div className="sw-readonly">
                {typeof setup.senderEmail === "string" && setup.senderEmail
                  ? setup.senderEmail
                  : "No sending address configured"}
              </div>
              <p className="sw-hint">
                Configuration status does not verify domain authentication or
                inbox placement.
              </p>
            </section>
          </>
        )}
        {section === "advanced" && (
          <>
            <div className="sw-heading">
              <div>
                <p className="sw-eyebrow">ADMINISTRATOR TOOLS</p>
                <h2>Advanced settings</h2>
                <p>Connection setup, contact migration, and troubleshooting.</p>
              </div>
            </div>
            <section className="sw-card">
              <h3>Shopify event connection</h3>
              <p>
                Register the customer, tag, and checkout events used by your
                workflows. Existing matching connections are kept.
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  run(
                    "connect",
                    async () => {
                      const r = await action<ConnectionResult>({
                        action: "register-shopify-webhooks",
                      });
                      setConnections(r);
                      return r;
                    },
                    () =>
                      "Shopify event registration completed. Review the results below.",
                  )
                }
              >
                {busy === "connect" ? "Connecting…" : "Connect Shopify events"}
              </button>
              {connections && (
                <ul className="sw-connection-results">
                  {connections.results.map((r) => (
                    <li key={r.topic}>
                      <span>{r.topic.toLowerCase().replaceAll("_", " ")}</span>
                      <Tag active={r.status !== "SKIPPED"}>
                        {r.status === "EXISTING"
                          ? "Already connected"
                          : r.status === "CREATED"
                            ? "Connected"
                            : "Check details"}
                      </Tag>
                      {r.message && <small>{r.message}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="sw-card">
              <h3>Subscriber migration</h3>
              <p>
                Before enabling customer sending, confirm that subscriber
                consent and unsubscribe/block history have been reviewed and
                migrated where needed.
              </p>
              <Toggle
                label="Subscriber history reviewed"
                text="Confirm only after checking both subscribers and contacts who must not receive marketing."
                checked={migration}
                change={setMigration}
                disabled={!!busy}
              />
              {migration && deployment.migrationConfirmed === false && (
                <p className="sw-warning">
                  Deployment confirmation is also required from your
                  administrator.
                </p>
              )}
              <div className="sw-save-row">
                <span>
                  {migrationDirty
                    ? "Unsaved review status"
                    : "Review status saved"}
                </span>
                <button
                  disabled={!!busy || !migrationDirty}
                  onClick={() =>
                    save(
                      "migration",
                      { operations: { migrationConfirmed: migration } },
                      () => {},
                    )
                  }
                >
                  Save review status
                </button>
              </div>
            </section>
            <section className="sw-card">
              <details>
                <summary>Import prepared contacts</summary>
                <p>
                  Use a prepared JSON file containing up to 500 contacts. Import
                  blocked and unsubscribed contacts before subscribers. Existing
                  blocks are preserved; imported customers do not start welcome
                  flows automatically.
                </p>
                <label>
                  Prepared contact file
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={!!busy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setValidated("");
                      setBusy("file");
                      try {
                        if (file.size > 2000000)
                          throw new Error("Choose a file smaller than 2 MB.");
                        updateImport(await file.text());
                        setError("");
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "File could not be read.",
                        );
                      } finally {
                        setBusy("");
                      }
                    }}
                  />
                </label>
                <label>
                  Prepared contact data
                  <textarea
                    aria-label="Prepared contact data"
                    rows={6}
                    disabled={!!busy}
                    value={importText}
                    onChange={(e) => updateImport(e.target.value)}
                    placeholder="Paste a prepared JSON array, or choose a file above."
                  />
                </label>
                <details className="sw-import-help">
                  <summary>File format guidance</summary>
                  <p>
                    Each row needs an email, phone number, or Shopify customer
                    ID. Subscribed rows also require their original consent
                    timestamp and source. Ask your administrator to prepare the
                    export; a raw Klaviyo CSV cannot be uploaded here.
                  </p>
                  <code>
                    email, name, phone, shopifyId, emailStatus, emailSuppressed,
                    consentAt, consentSource, tags, lists, lastOpenedAt,
                    lastOrderAt
                  </code>
                </details>
                <div className="sw-import-actions">
                  <button
                    disabled={!!busy || !importText.trim()}
                    onClick={() =>
                      run(
                        "validate",
                        async () => {
                          setValidated("");
                          const r = await action<{ results: ImportResult[] }>({
                            action: "import",
                            rows: importRows(),
                            dryRun: true,
                          });
                          setImportResults(r.results);
                          setImported(false);
                          if (
                            r.results.length > 0 &&
                            r.results.every((x) => x.status === "VALID")
                          )
                            setValidated(importText);
                          return r;
                        },
                        (r) =>
                          r.results.every((x) => x.status === "VALID")
                            ? "Validation passed. No contacts have been imported yet."
                            : "Some rows need correction before importing.",
                      )
                    }
                  >
                    {busy === "validate" ? "Checking…" : "1. Validate contacts"}
                  </button>
                  <button
                    className="sw-primary"
                    disabled={
                      !!busy ||
                      !validated ||
                      validated !== importText ||
                      imported
                    }
                    onClick={() =>
                      run(
                        "import",
                        async () => {
                          const rows = importRows();
                          setValidated("");
                          const r = await action<{ results: ImportResult[] }>({
                            action: "import",
                            rows,
                            dryRun: false,
                          });
                          setImportResults(r.results);
                          setImported(true);
                          return r;
                        },
                        (r) =>
                          r.results.filter((x) => x.status === "IMPORTED")
                            .length +
                          " contacts imported. Review any row errors below.",
                      )
                    }
                  >
                    {busy === "import"
                      ? "Importing…"
                      : "2. Import validated contacts"}
                  </button>
                </div>
                {importResults && (
                  <div className="sw-import-results">
                    <p>
                      {importResults.filter((r) => r.status !== "ERROR").length}{" "}
                      {imported ? "imported" : "valid"} ·{" "}
                      {importResults.filter((r) => r.status === "ERROR").length}{" "}
                      errors
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Result</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResults.map((r) => (
                          <tr key={r.row}>
                            <td>{r.row}</td>
                            <td>
                              {r.status === "VALID"
                                ? "Valid"
                                : r.status === "IMPORTED"
                                  ? "Imported"
                                  : "Needs correction"}
                            </td>
                            <td>{r.error || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </section>
            <section className="sw-card">
              <details>
                <summary>Technical diagnostics</summary>
                <p>
                  For your administrator. Configured services still need real
                  delivery testing.
                </p>
                <dl className="sw-diagnostics">
                  <div>
                    <dt>Email provider</dt>
                    <dd>
                      {setup.emailReady
                        ? "Configured"
                        : "Incomplete configuration"}
                    </dd>
                  </div>
                  <div>
                    <dt>Text message provider</dt>
                    <dd>{setup.smsReady ? "Configured" : "Not configured"}</dd>
                  </div>
                  <div>
                    <dt>Signup coupon</dt>
                    <dd>
                      {setup.couponReady ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  <div>
                    <dt>Storefront origin</dt>
                    <dd>
                      {String(setup.storefrontOrigin || "Not configured")}
                    </dd>
                  </div>
                  <div>
                    <dt>Last worker run</dt>
                    <dd>{date(worker?.at)}</dd>
                  </div>
                  {!!worker?.skipped && (
                    <div>
                      <dt>Last run note</dt>
                      <dd>{String(worker.skipped)}</dd>
                    </div>
                  )}
                </dl>
                <p>
                  Credentials and deployment switches are managed in the hosting
                  environment. No credentials are displayed here.
                </p>
              </details>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
