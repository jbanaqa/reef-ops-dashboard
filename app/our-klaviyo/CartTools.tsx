"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { FlowConfig } from "@/lib/marketing/flow-config";
import type { Content } from "@/lib/marketing/rules";
import FlowDialog from "./FlowDialog";
type History = {
  missingMetrics?: string[];
  configured: boolean;
  phase: string;
  imported: number;
  ignored: number;
  metric?: string;
  error?: string;
  completedAt?: string;
};
type Report = {
  rows: {
    key: string;
    label: string;
    waiting: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    orders: number;
    revenue: Record<string, number>;
    stopped: number;
    needsAttention: number;
  }[];
  reasons: { reason: string; count: number }[];
};
export default function CartTools({ flow }: { flow: FlowConfig }) {
  const [panel, setPanel] = useState<"products" | "history" | "results" | null>(
    null,
  );
  const [address, setAddress] = useState("");
  const [products, setProducts] = useState<Content["products"] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stop = useRef(false),
    generation = useRef(0);
  useEffect(
    () => () => {
      stop.current = true;
      generation.current++;
    },
    [],
  );
  async function request(action: string, body: object = {}) {
    const r = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not finish the request.");
    return d;
  }
  async function open(next: NonNullable<typeof panel>) {
    const own = ++generation.current;
    setHistory(null);
    setReport(null);
    setProducts(null);
    setPanel(next);
    setError("");
    setBusy(true);
    stop.current = false;
    try {
      if (next !== "products") {
        const r = await fetch(
          "/api/marketing?view=" +
            (next === "history" ? "cart-history" : "cart-report"),
        );
        const d = await r.json();
        if (own !== generation.current) return;
        if (!r.ok) throw new Error(d.error || "Could not load data.");
        if (next === "history") setHistory(d);
        else setReport(d);
      }
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : "Could not load data.");
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  async function importHistory() {
    setBusy(true);
    setError("");
    stop.current = false;
    const own = generation.current;
    try {
      do {
        const d = (await request("sync-cart-history")) as History;
        if (own !== generation.current) return;
        setHistory(d);
        if (d.error) throw new Error(d.error);
        if (d.phase === "complete") break;
      } while (!stop.current && own === generation.current);
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : "Import paused.");
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  const close = () => {
    stop.current = true;
    generation.current++;
    setPanel(null);
  };
  return (
    <>
      <div className="mk-cart-tool-actions">
        <button type="button" onClick={() => open("products")}>
          Preview customer products
        </button>
        <button type="button" onClick={() => open("history")}>
          Bring over Klaviyo history
        </button>
        <button type="button" onClick={() => open("results")}>
          View flow results
        </button>
      </div>
      {panel && (
        <FlowDialog
          title={
            panel === "products"
              ? "Preview customer products"
              : panel === "history"
                ? "Klaviyo history"
                : "Flow results · last 30 days"
          }
          close={close}
        >
          {error && <p role="alert">{error}</p>}
          {panel === "products" && (
            <>
              <p>
                See which products a customer would receive using this draft’s
                product count. No email is sent.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const own = generation.current;
                  setBusy(true);
                  setError("");
                  setProducts(null);
                  try {
                    const d = await request("preview-cart-products", {
                      email: address,
                      flow,
                    });
                    if (own === generation.current) setProducts(d.products);
                  } catch (e) {
                    if (own === generation.current)
                      setError(
                        e instanceof Error ? e.message : "Preview failed.",
                      );
                  } finally {
                    if (own === generation.current) setBusy(false);
                  }
                }}
              >
                <label>
                  Customer email
                  <input
                    type="email"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
                <button disabled={busy}>
                  {busy ? "Loading products…" : "Preview products"}
                </button>
              </form>
              {products && (
                <>
                  <p>
                    {products.length} available products selected. Cart activity
                    from the last 90 days comes first, followed by popular
                    products from the last 3 days.
                  </p>
                  <div className="mk-cart-product-grid">
                    {products.map((p, i) => (
                      <a
                        key={p.url + ":" + i}
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {p.image && <img src={p.image} alt="" loading="lazy" />}
                        <strong>{p.title}</strong>
                        <span>{p.price}</span>
                      </a>
                    ))}
                  </div>
                  {!products.length && (
                    <p>
                      There are no matching products yet. Check tracking and
                      history, or choose more than zero products in Product
                      recommendations.
                    </p>
                  )}
                </>
              )}
              <details>
                <summary>Connect product-view tracking</summary>
                <p>
                  In Shopify, open Settings → Customer events → Add custom
                  pixel. Paste the downloaded script, require marketing and
                  analytics consent, then connect it. Visit a product page with
                  consent enabled and run Check Shopify connection to confirm
                  activity arrived.
                </p>
                <a href="/api/marketing?view=tracking-pixel" download>
                  Download tracking script for this store
                </a>
              </details>
            </>
          )}
          {panel === "history" && (
            <>
              <p>
                Bring over cart activity, product popularity and recent email
                history. This does not send messages or change subscriptions.
              </p>
              {busy && !history && <p role="status">Loading connection…</p>}
              {history && (
                <>
                  <p role="status">
                    {busy
                      ? "Importing " + (history.metric || "history") + "…"
                      : history.phase === "complete"
                        ? "Import complete."
                        : history.phase === "not-started"
                          ? "History has not been imported yet."
                          : "Import paused. You can resume here."}{" "}
                    {history.imported.toLocaleString()} events processed.
                  </p>
                  {history.ignored > 0 && (
                    <p>
                      {history.ignored} records could not be used because their
                      product, customer or date information was incomplete.
                    </p>
                  )}
                  {!history.configured ? (
                    <div className="mk-cart-feed-note">
                      <strong>One connection step is needed</strong>
                      <p>
                        Add a Klaviyo private API key to Reef Ops in Railway as{" "}
                        <code>KLAVIYO_PRIVATE_API_KEY</code>, with read access
                        for events, metrics and profiles. Keep the key in
                        Railway; do not paste it into this page or chat.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={importHistory}
                    >
                      {history.phase === "complete"
                        ? "Refresh history"
                        : history.phase === "not-started"
                          ? "Start import"
                          : "Resume import"}
                    </button>
                  )}
                  {busy && (
                    <button
                      type="button"
                      onClick={() => {
                        stop.current = true;
                      }}
                    >
                      Pause after this batch
                    </button>
                  )}
                  {!!history.missingMetrics?.length && (
                    <p>
                      Not found in this Klaviyo account:{" "}
                      {history.missingMetrics.join(", ")}. These parts will use
                      only activity Reef Ops collects.
                    </p>
                  )}
                  {history.completedAt && (
                    <p>
                      Last completed:{" "}
                      {new Date(history.completedAt).toLocaleString()}
                    </p>
                  )}
                </>
              )}
              <p>
                Before switching from Klaviyo, draft the equivalent flow there,
                then refresh history here so recent Klaviyo emails count toward
                the 16-hour limit.
              </p>
            </>
          )}
          {panel === "results" && (
            <>
              {busy && <p>Loading results…</p>}
              {report && (
                <>
                  <p>
                    Messages created in the last 30 days. Opens and clicks count
                    each message once; email privacy features can affect open
                    counts.
                  </p>
                  <div className="mk-cart-results">
                    {report.rows.map((r) => (
                      <section key={r.key}>
                        <h4>{r.label}</h4>
                        <dl>
                          {[
                            ["Waiting", r.waiting],
                            ["Sent", r.sent],
                            ["Delivered", r.delivered],
                            ["Opened", r.opened],
                            ["Clicked", r.clicked],
                            ["Orders", r.orders],
                            ["Stopped / skipped", r.stopped],
                            ["Needs attention", r.needsAttention],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {r.sent > 0 && (
                          <p>
                            Open rate {Math.round((100 * r.opened) / r.sent)}% ·
                            Click rate {Math.round((100 * r.clicked) / r.sent)}%
                          </p>
                        )}
                        {Object.entries(r.revenue).map(([currency, amount]) => (
                          <p key={currency}>
                            Attributed sales: {currency} {amount.toFixed(2)}
                          </p>
                        ))}
                      </section>
                    ))}
                  </div>
                  {!!report.reasons.length && (
                    <details>
                      <summary>Why messages are waiting or stopped</summary>
                      <ul>
                        {report.reasons.map((r) => (
                          <li key={r.reason}>
                            {r.reason} ({r.count})
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p>
                    Sales use Reef Ops’ last-click / last-open attribution and
                    may differ from Klaviyo’s reports.
                  </p>
                </>
              )}
            </>
          )}
        </FlowDialog>
      )}
    </>
  );
}
