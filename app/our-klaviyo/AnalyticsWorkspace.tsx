"use client";

import { useEffect, useState } from "react";

type AnalyticsRow = {
  key: string;
  kind: "FLOW" | "CAMPAIGN";
  name: string;
  messages: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue: Record<string, number>;
};
type AnalyticsReport = {
  days: number;
  since: string;
  totals: {
    messages: number;
    sent: number;
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
}: {
  heading: string;
  rows: AnalyticsRow[];
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
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.key}`}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.messages.toLocaleString()} created messages</small>
                  </td>
                  <td>{row.sent.toLocaleString()}</td>
                  <td>{rate(row.opened, row.delivered || row.sent)}</td>
                  <td>{rate(row.clicked, row.delivered || row.sent)}</td>
                  <td>
                    <strong>{row.orders.toLocaleString()}</strong>
                    <small>{rate(row.orders, row.sent)} of sent</small>
                  </td>
                  <td>{money(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No messages were created in this period.</p>
      )}
    </section>
  );
}

export default function AnalyticsWorkspace() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/marketing?view=analytics&days=${days}`, {
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
  }, [days, refresh]);

  const flows = report?.rows.filter((row) => row.kind === "FLOW") || [];
  const campaigns = report?.rows.filter((row) => row.kind === "CAMPAIGN") || [];
  return (
    <div className="mk-analytics-workspace">
      <header className="mk-analytics-heading">
        <div>
          <p className="mk-eyebrow">MARKETING RESULTS</p>
          <h2>Revenue and engagement</h2>
          <p>
            Compare attributed sales from automated flows and one-time campaigns.
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
          <div className="mk-analytics-summary" aria-busy={loading}>
            <article>
              <span>Attributed revenue</span>
              <strong>{money(report.totals.revenue)}</strong>
              <small>Gross order value tied to a Reef Ops message</small>
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
              <span>Order rate</span>
              <strong>{rate(report.totals.orders, report.totals.sent)}</strong>
              <small>Attributed orders divided by sent messages</small>
            </article>
          </div>
          <PerformanceTable heading="Automated flows" rows={flows} />
          <PerformanceTable heading="Campaigns" rows={campaigns} />
          <section className="mk-panel mk-analytics-notes">
            <h2>How revenue is attributed</h2>
            <p>
              An order is credited to the most recent Reef Ops click within five
              days, or otherwise the most recent open within one day. Revenue is
              gross order value before refunds. Opens may include privacy-proxy
              activity, and currencies remain separate instead of being converted.
            </p>
            <p>
              Total tracked store revenue for this period: {money(report.totals.storeRevenue)}.
            </p>
          </section>
        </>
      )}
      {!report && loading && <p role="status">Loading marketing results…</p>}
    </div>
  );
}
