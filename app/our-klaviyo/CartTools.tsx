"use client";
/* eslint-disable @next/next/no-img-element */
import { useMarketingBrand } from "./MarketingBrand";
import { useEffect, useRef, useState } from "react";
import type { FlowConfig } from "@/lib/marketing/flow-config";
import type { Content } from "@/lib/marketing/rules";
import FlowDialog from "./FlowDialog";
import FlowResults from "./FlowResults";
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
export default function CartTools({ flow }: { flow: FlowConfig }) {
  const { marketingFetch, apiUrl } = useMarketingBrand();
  const [panel, setPanel] = useState<"products" | "history" | null>(
    null,
  );
  const [address, setAddress] = useState("");
  const [products, setProducts] = useState<Content["products"] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
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
    const r = await marketingFetch("/api/marketing", {
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
    setProducts(null);
    setPanel(next);
    setError("");
    setBusy(true);
    stop.current = false;
    try {
      if (next !== "products") {
        const r = await marketingFetch(
          "/api/marketing?view=cart-history",
        );
        const d = await r.json();
        if (own !== generation.current) return;
        if (!r.ok) throw new Error(d.error || "Could not load data.");
        setHistory(d);
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
        <FlowResults flowKey="abandoned-cart" />
      </div>
      {panel && (
        <FlowDialog
          title={
            panel === "products"
              ? "Preview customer products"
              : "Klaviyo history"
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
                <a href={apiUrl("/api/marketing?view=tracking-pixel")} download>
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
                the 16-hour spacing window.
              </p>
            </>
          )}
        </FlowDialog>
      )}
    </>
  );
}
