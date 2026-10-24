"use client";

import { useMarketingBrand } from "./MarketingBrand";
import { useEffect, useState } from "react";
import FlowResults from "./FlowResults";
import PaymentVerificationNotice, { type PaymentVerification } from "./PaymentVerificationNotice";

type AnalyticsRow = {
  key: string;
  kind: "FLOW" | "CAMPAIGN";
  name: string;
  messages: number;
  sent: number;
  recipients: number;
  convertedRecipients: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue: Record<string, number>;
};
type AnalyticsReport = {
  paymentVerification?: PaymentVerification;
  days: number;
  since: string;
  attribution: {
    emailClickDays: number;
    emailOpenDays: number;
  };
  totals: {
    messages: number;
    sent: number;
    recipients: number;
    convertedRecipients: number;
    delivered: number;
    opened: number;
    clicked: number;
    orders: number;
    trackedOrders: number;
    revenue: Record<string, number>;
    storeRevenue: Record<string, number>;
  };
  rows: AnalyticsRow[];
};

const rate = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "—";
const money = (values: Record<string, number>) => {
  const entries = Object.entries(values);
  return entries.length
    ? entries
        .map(
          ([currency, amount]) =>
            `${currency} ${amount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
        )
        .join(" · ")
    : "—";
};

function PerformanceTable({
  heading,
  rows,
  viewFlow,
}: {
  heading: string;
  rows: AnalyticsRow[];
  viewFlow?: (key: "welcome" | "abandoned-cart") => void;
}) {
  return (
    <section className="mk-analytics-table mk-panel">
      <div className="mk-analytics-section-heading">
        <div>
          <p className="mk-eyebrow">PERFORMANCE</p>
          <h2>{heading}</h2>
        </div>
        <span className="mk-status">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="mk-analytics-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sent</th>
                <th>Open rate</th>
                <th>Click rate</th>
                <th>Orders</th>
                <th>Customer conversion</th>
                <th>Paid revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.key}`}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.messages.toLocaleString()} messages sent in period</small>
                    {viewFlow && (row.key === "welcome" || row.key === "abandoned-cart") && <button
                      type="button" className="mk-flow-row-results" onClick={() => viewFlow(row.key as "welcome" | "abandoned-cart")}>
                      View results
                    </button>}
                  </td>
                  <td>{row.sent.toLocaleString()}</td>
                  <td>{rate(row.opened, row.sent)}</td>
                  <td>{row.clicked ? rate(row.clicked, row.sent) : "No recorded clicks"}</td>
                  <td>
                    <strong>{row.orders.toLocaleString()}</strong>
                  </td>
                  <td>{rate(row.convertedRecipients, row.recipients)}<small>{row.convertedRecipients.toLocaleString()} buyers / {row.recipients.toLocaleString()} recipients</small></td>
                  <td>{money(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No messages were sent in this period.</p>
      )}
    </section>
  );
}

export default function AnalyticsWorkspace() {
  const { marketingFetch, brand } = useMarketingBrand();
  const isMacro = brand.id === "macroalgae-farms";
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [resultsFlow, setResultsFlow] = useState<"welcome" | "abandoned-cart" | null>(null);
  const [attributionDraft, setAttributionDraft] = useState<{
    emailClickDays: number;
    emailOpenDays: number;
  } | null>(null);
  const [savingAttribution, setSavingAttribution] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    marketingFetch(`/api/marketing?view=analytics&days=${days}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not load marketing analytics.");
        return result as AnalyticsReport;
      })
      .then((result) => {
        if (!controller.signal.aborted) setReport(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load marketing analytics.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, refresh, marketingFetch]);

  const flows = report?.rows.filter((row) => row.kind === "FLOW") || [];
  const campaigns = report?.rows.filter((row) => row.kind === "CAMPAIGN") || [];
  const attribution = attributionDraft || report?.attribution;
  async function saveAttribution() {
    if (!attribution) return;
    setSavingAttribution(true);
    setError("");
    try {
      const response = await marketingFetch("/api/marketing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save-settings",
          settings: { attribution },
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save attribution settings.");
      setAttributionDraft(null);
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save attribution settings.",
      );
    } finally {
      setSavingAttribution(false);
    }
  }
  return (
    <div className="mk-analytics-workspace">
      <header className="mk-analytics-heading">
        <div>
          <p className="mk-eyebrow">MARKETING RESULTS</p>
          <h2>Revenue and engagement</h2>
          <p>
            {isMacro ? "Track attributed sales and engagement from Macroalgae Farms campaigns." : "Compare attributed sales from automated flows and one-time campaigns."}
          </p>
        </div>
        <div className="mk-analytics-controls">
          <label>
            Reporting period
            <select
              value={days}
              onChange={(event) => {
                setLoading(true);
                setError("");
                setDays(Number(event.target.value));
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 365 days</option>
            </select>
          </label>
          <button
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>
      {error && (
        <div className="mk-error" role="alert">
          {error}
        </div>
      )}
      {report && (
        <>
          <PaymentVerificationNotice verification={report.paymentVerification} className="mk-notice" />
          <div className="mk-analytics-summary" aria-busy={loading}>
            <article>
              <span>Attributed paid revenue</span>
              <strong>{money(report.totals.revenue)}</strong>
              <small>Payments received minus refunds</small>
            </article>
            <article>
              <span>Attributed orders</span>
              <strong>{report.totals.orders.toLocaleString()}</strong>
              <small>
                {rate(report.totals.orders, report.totals.trackedOrders)} of {report.totals.trackedOrders.toLocaleString()} tracked orders
              </small>
            </article>
            <article>
              <span>Messages sent</span>
              <strong>{report.totals.sent.toLocaleString()}</strong>
              <small>{report.totals.delivered.toLocaleString()} confirmed delivered</small>
            </article>
            <article>
              <span>Customer conversion</span>
              <strong>{rate(report.totals.convertedRecipients, report.totals.recipients)}</strong>
              <small>{report.totals.convertedRecipients.toLocaleString()} buyers / {report.totals.recipients.toLocaleString()} recipients</small>
            </article>
          </div>
          {!isMacro && <PerformanceTable heading="Automated flows" rows={flows} viewFlow={setResultsFlow} />}
          <PerformanceTable heading="Campaigns" rows={campaigns} />
          <section className="mk-panel mk-attribution-settings">
            <div>
              <p className="mk-eyebrow">OPEN &amp; CLICK CREDIT</p>
              <h2>Attribution settings</h2>
              <p>
                The most recent qualifying email open or click receives the
                order{!isMacro && ", except for verified assigned Welcome-code redemption"}.
                The window begins at delivery when recorded. Changing either
                window recalculates engagement-based credit from recorded history.
              </p>
            </div>
            {attribution && (
              <div className="mk-attribution-fields">
                <label>
                  Email click window
                  <span>
                    <input
                      aria-label="Email click attribution days"
                      type="number"
                      min={1}
                      max={90}
                      value={attribution.emailClickDays}
                      onChange={(event) =>
                        setAttributionDraft({
                          ...attribution,
                          emailClickDays: Number(event.target.value),
                        })
                      }
                    />
                    days
                  </span>
                </label>
                <label>
                  Email open window
                  <span>
                    <input
                      aria-label="Email open attribution days"
                      type="number"
                      min={1}
                      max={90}
                      value={attribution.emailOpenDays}
                      onChange={(event) =>
                        setAttributionDraft({
                          ...attribution,
                          emailOpenDays: Number(event.target.value),
                        })
                      }
                    />
                    days
                  </span>
                </label>
                <button
                  disabled={
                    savingAttribution ||
                    !attributionDraft ||
                    !Number.isInteger(attribution.emailClickDays) ||
                    attribution.emailClickDays < 1 ||
                    attribution.emailClickDays > 90 ||
                    !Number.isInteger(attribution.emailOpenDays) ||
                    attribution.emailOpenDays < 1 ||
                    attribution.emailOpenDays > 90
                  }
                  onClick={saveAttribution}
                >
                  {savingAttribution ? "Saving…" : "Save attribution settings"}
                </button>
              </div>
            )}
            <small>
              Resend identifies the exact email that opened or was clicked, but
              does not label Apple privacy opens or bot clicks in these webhook
              events. Reef Ops cannot reproduce Klaviyo’s optional exclusion
              toggles for those signals with the current provider data.
            </small>
          </section>
          <section className="mk-panel mk-analytics-notes">
            <h2>How revenue is attributed</h2>
            <p>
              {isMacro ? "Campaigns use the most recent qualifying email interaction within the windows above." : "Campaigns and other flows use the most recent qualifying email interaction within the windows above. Welcome uses that rule for the first qualifying purchase after signup; later purchases count only when they redeem that customer’s assigned Welcome code. Verified Welcome-code redemption requires a prior Welcome offer email, and can receive credit without a recorded open or click."}
              Each order receives one credit. The selected period is based on when
              the credited message was sent. Paid revenue is payments received minus refunds,
              including tax and shipping. Opens may
              include privacy-proxy activity, and currencies remain separate
              instead of being converted.
            </p>
            <p>
              Total tracked paid revenue for this period: {money(report.totals.storeRevenue)}.
            </p>
          </section>
        </>
      )}
      {!report && loading && <p role="status">Loading marketing results…</p>}
      {resultsFlow && <FlowResults key={resultsFlow} flowKey={resultsFlow} autoOpen initialDays={days} onClose={() => setResultsFlow(null)} />}
    </div>
  );
}
