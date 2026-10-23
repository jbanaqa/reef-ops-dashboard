"use client";
import { useMarketingBrand } from "./MarketingBrand";
import { useEffect, useRef, useState } from "react";
import type { CampaignReport } from "./campaign-report-types";
import "./campaign-orders.css";

function date(value: string) {
  return new Date(value).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function CampaignOrders({ report, onLoaded }: {
  report: CampaignReport; onLoaded: (report: CampaignReport) => void;
}) {
  const { marketingFetch } = useMarketingBrand();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load(page: number) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError("");
    try {
      const response = await marketingFetch(`/api/marketing?view=campaign-report&id=${encodeURIComponent(report.campaign.id)}&ordersPage=${page}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load attributed orders.");
      if (!controller.signal.aborted) onLoaded(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load attributed orders.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const paging = report.ordersPage || { page: 1, pages: 1, total: 0, pageSize: 25 };
  return <section className="mk-attributed-orders" aria-label="Attributed orders" aria-busy={busy}>
    <div className="mk-order-heading">
      <div><h4>Attributed orders <span>({paging.total.toLocaleString()})</span></h4><p>Orders included in the revenue above. All times Pacific.</p></div>
      <button disabled={busy} onClick={() => void load(paging.page)}>Refresh orders</button>
    </div>
    {error && <p role="alert">{error} <button disabled={busy} onClick={() => void load(paging.page)}>Try again</button></p>}
    {!report.orders?.length ? <p className="mk-order-empty">No orders have been attributed to this campaign yet.</p> : <>
      <ol className="mk-order-list" aria-label="Orders credited to this campaign">
        {report.orders.map(order => <li key={order.id}>
          <div className="mk-order-summary">
            {order.shopifyUrl ? <a href={order.shopifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${order.label} in Shopify`}>{order.label} ↗</a> : <strong>{order.label}</strong>}
            <time dateTime={order.placedAt}>{date(order.placedAt)}</time>
            <small>{order.interaction === "COUPON" ? "Coupon redeemed" : "Credited after email " + (order.interaction === "CLICKED" ? "click" : "open")} · {date(order.interactedAt)}</small>
          </div>
          <div className="mk-order-customer"><span>Customer</span><strong>{order.customer?.name || order.customer?.email || "Customer unavailable"}</strong>{order.customer?.name && order.customer.email && <small>{order.customer.email}</small>}</div>
          <div className="mk-order-amount"><span>Revenue</span><strong>{order.amount !== null && order.currency ? `${order.currency} ${order.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Amount unavailable"}</strong></div>
        </li>)}
      </ol>
      <p className="mk-order-note">Revenue shows recorded order totals before refunds.</p>
    </>}
    {paging.pages > 1 && <nav className="mk-order-pagination" aria-label="Attributed orders pages">
      <button disabled={busy || paging.page <= 1} onClick={() => void load(paging.page - 1)}>Previous orders</button>
      <span>Page {paging.page} of {paging.pages}</span>
      <button disabled={busy || paging.page >= paging.pages} onClick={() => void load(paging.page + 1)}>Next orders</button>
    </nav>}
  </section>;
}
