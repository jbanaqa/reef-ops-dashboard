"use client";

import { useMarketingBrand } from "./MarketingBrand";
import { useEffect, useId, useRef, useState } from "react";
import type { FlowReport } from "@/lib/marketing/flow-report";

type FlowKey = "welcome" | "abandoned-cart";
type Metrics = FlowReport["totals"];
const number = (value: number) => value.toLocaleString("en-US");
const rate = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "—";
const date = (value: string) => new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric",
  year: "numeric", hour: "numeric", minute: "2-digit",
});
const money = (values: Record<string, number>) => {
  const entries = Object.entries(values);
  return entries.length ? entries.map(([currency, amount]) =>
    `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ).join(" · ") : "No attributed paid revenue";
};
const names: Record<FlowKey, string> = {
  welcome: "Welcome", "abandoned-cart": "Abandoned Cart",
};
const statusLabels: Record<string, string> = {
  UNKNOWN: "Needs review", PENDING: "Waiting", SENT: "Sent",
  SENDING: "Sending", CANCELLED: "Stopped", FAILED: "Failed",
};
const interactionNames: Record<string, string> = {
  OPENED: "Recorded open", CLICKED: "Recorded click", COUPON: "Coupon redeemed",
};
const attributionNames: Record<string, string> = {
  OPENED: "Open-based attribution", CLICKED: "Click-based attribution", COUPON: "Code-based attribution",
};

function DeliveryMetrics({ metrics }: { metrics: Metrics }) {
  const items = [
    ["Delivered", metrics.delivered], ["Opened", metrics.opened],
    ["Bounced", metrics.bounced], ["Spam complaints", metrics.complained],
    ["Unsubscribed", metrics.unsubscribed],
  ] as const;
  return <dl className="mk-fr-delivery">
    {items.map(([label, value]) => <div key={label}>
      <dt>{label}</dt><dd>{number(value)} <small>{rate(value, metrics.sent)} of sent</small></dd>
    </div>)}
  </dl>;
}

function ResultsDialog({ flowKey, close, initialDays }: {
  flowKey: FlowKey; close: () => void; initialDays: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { marketingFetch } = useMarketingBrand();
  const [request, setRequest] = useState({ days: initialDays, page: 1, version: 0 });
  const [response, setResponse] = useState<{
    request: typeof request; report?: FlowReport; error?: string;
  } | null>(null);
  const current = response?.request === request ? response : null;
  const report = current?.report;
  const loading = current === null;
  useEffect(() => {
    const element = dialog.current!;
    const focus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (focus?.isConnected) focus.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      view: "flow-report", key: flowKey,
      days: String(request.days), ordersPage: String(request.page),
    });
    async function load() {
      try {
        const result = await marketingFetch(`/api/marketing?${params}`, {
          cache: "no-store", signal: controller.signal,
        });
        const payload = await result.json();
        if (!result.ok) throw Error(payload.error || "Could not load flow results.");
        if (!controller.signal.aborted) setResponse({ request, report: payload });
      } catch (error) {
        if (!controller.signal.aborted) setResponse({ request,
          error: error instanceof Error ? error.message : "Could not load flow results.",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [flowKey, request, marketingFetch]);
  const refresh = () => setRequest(value => ({ ...value, version: value.version + 1 }));
  return <dialog ref={dialog} className="mk-flow-results-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="mk-fr-header">
      <div><p className="mk-eyebrow">FLOW RESULTS</p><h2 id={titleId}>{names[flowKey]}</h2></div>
      <button type="button" onClick={close}>Close</button>
    </header>
    <div className="mk-flow-results">
      <div className="mk-fr-toolbar">
        <label>Reporting period<select value={request.days}
          onChange={event => setRequest(value => ({ ...value, days: Number(event.target.value), page: 1 }))}>
          {[7, 30, 90, 365].map(days => <option key={days} value={days}>Last {days} days</option>)}
        </select></label>
        <button type="button" disabled={loading} onClick={refresh}>{loading ? "Loading…" : "Refresh results"}</button>
      </div>
      <p className="mk-fr-caption">Based on emails sent in the selected period. Customer sends only; tests are excluded. All times Pacific.</p>
      {current?.error && <div className="mk-fr-error" role="alert">
        <p>{current.error}</p><button type="button" onClick={refresh}>Try again</button>
      </div>}
      {loading && <p role="status" className="mk-fr-loading">Loading flow results…</p>}
      {report && <>
        {!!report.paymentVerification?.unverifiedOrders && <p className="mk-fr-caption" role="status">Shopify payments could not be verified for {number(report.paymentVerification.unverifiedOrders)} {report.paymentVerification.unverifiedOrders === 1 ? "order" : "orders"}. Revenue and attribution may be incomplete.</p>}
        <div className="mk-fr-summary">
          <article><span>Attributed paid revenue</span><strong>{money(report.totals.revenue)}</strong><small>Payments received minus refunds</small></article>
          <article><span>Attributed orders</span><strong>{number(report.totals.orders)}</strong><small>See each credited order below</small></article>
          <article><span>Buyer conversion</span><strong>{rate(report.totals.convertedRecipients, report.totals.recipients)}</strong><small>{number(report.totals.convertedRecipients)} buyers / {number(report.totals.recipients)} email recipients</small></article>
          <article><span>Emails sent</span><strong>{number(report.totals.sent)}</strong><small>{number(report.totals.delivered)} confirmed delivered</small></article>
        </div>
        <DeliveryMetrics metrics={report.totals} />
        <details className="mk-fr-explanation">
          <summary>How sales are credited</summary>
          {flowKey === "welcome" ? <>
            <p>Welcome can receive credit for the first qualifying purchase after signup, or an order using that customer’s assigned Welcome code. Repeat purchases without that code do not count.</p>
            <p>First-purchase credit requires the Welcome email to win the normal attribution rules: the most recent qualifying open or click across Reef Ops, within {report.attribution.emailClickDays} days of delivery for clicks or {report.attribution.emailOpenDays} days for opens. Send time is used when delivery is unavailable.</p>
            <p>Welcome-code redemption can receive credit without a recorded open or click, outside those windows. A genuine Welcome offer email must have been sent to the customer before purchase. Each order is counted once.</p>
          </> : <p>An order is credited to the most recent qualifying email open or click across Reef Ops flows and campaigns, using the same rules as Analytics: {report.attribution.emailClickDays}-day clicks and {report.attribution.emailOpenDays}-day opens. The attribution window starts at delivery when recorded, otherwise at send. Verified assigned Welcome-code redemption takes priority.</p>}
          <p>Buyer conversion counts distinct recipients with a credited order divided by distinct recipients sent an email. A buyer can receive multiple emails and place multiple orders. Each order receives one credit.</p>
          <p>Paid revenue is payments received minus refunds, including tax and shipping. Currencies stay separate. Attribution shows an association; it does not prove the email caused the purchase. Privacy features and bots can inflate opens.</p>
          <p>{report.totals.clicked ? `${number(report.totals.clicked)} emails have recorded clicks.` : "No recorded clicks are available in this period. Click tracking is deferred; this does not mean nobody visited the site."}</p>
          <p>{flowKey === "welcome" ? "Order badges show first-purchase or Welcome-code credit. Historical orders may lack the details needed to verify code redemption." : "Checkout and flow-code badges add supporting evidence to orders already attributed above; they do not add extra revenue. Historical orders may lack the details needed to check them."}</p>
        </details>
        <section className="mk-fr-section" aria-label="Results by email">
          <h3>Results by email</h3>
          <div className="mk-fr-steps">{report.steps.map(step => <details key={step.key}>
            <summary><span>{step.label}<small>{number(step.sent)} sent · {number(step.orders)} attributed orders</small></span><strong>{money(step.revenue)}</strong></summary>
            <div className="mk-fr-step-body">
              <p>{rate(step.convertedRecipients, step.recipients)} buyer conversion · {number(step.convertedRecipients)} buyers / {number(step.recipients)} recipients</p>
              <DeliveryMetrics metrics={step} />
              <p>{number(step.waiting)} waiting · {number(step.stopped)} stopped or skipped · {number(step.needsAttention)} need attention</p>
              <p>{step.clicked ? `${number(step.clicked)} recorded clicks (${rate(step.clicked, step.sent)} of sent).` : "No recorded clicks available."}</p>
            </div>
          </details>)}</div>
        </section>
        <section className="mk-fr-section" aria-label="Attributed orders">
          <div className="mk-fr-section-heading"><h3>Attributed orders <span>({number(report.ordersPage.total)})</span></h3>
            <span>Orders included in paid revenue above</span></div>
          {report.ordersPage.total > 0 && <div className="mk-fr-evidence-summary">
            {flowKey === "abandoned-cart" && <span>{number(report.evidence.matchingCheckoutOrders)} same checkout</span>}
            <span>{number(report.evidence.discountOrders)} used a flow code</span>
            {flowKey === "abandoned-cart" && report.evidence.missingCheckoutDetails > 0 && <span>{number(report.evidence.missingCheckoutDetails)} with unavailable checkout details</span>}
          </div>}
          {!report.orders.length ? <p className="mk-fr-empty">No orders attributed to these emails yet.</p> : <ol className="mk-fr-orders">
            {report.orders.map(order => <li key={order.id}>
              <div className="mk-fr-order-heading">
                {order.shopifyUrl ? <a href={order.shopifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open order ${order.label} in Shopify`}>{order.label} ↗</a> : <strong>{order.label}</strong>}
                <strong>{order.amount !== null && order.currency ? money({ [order.currency]: order.amount }) : "Amount unavailable"}</strong>
              </div>
              <p className="mk-fr-customer">{order.email || "Customer email unavailable"}</p>
              <p className="mk-fr-credit">Credited to <strong>{order.step}</strong><small>{order.subject}</small></p>
              <dl className="mk-fr-timeline">
                <div><dt>Email sent</dt><dd><time dateTime={order.sentAt}>{date(order.sentAt)}</time></dd></div>
                <div><dt>{interactionNames[order.interaction] || "Recorded interaction"}</dt><dd><time dateTime={order.interactedAt}>{date(order.interactedAt)}</time></dd></div>
                <div><dt>Order placed</dt><dd><time dateTime={order.placedAt}>{date(order.placedAt)}</time></dd></div>
              </dl>
              <div className="mk-fr-badges">
                {flowKey === "abandoned-cart" && <span className={order.checkoutMatch ? "is-evidence" : ""}>{order.checkoutMatch === true ? "Same checkout" : order.checkoutMatch === false ? "Different checkout" : "Checkout details unavailable"}</span>}
                {flowKey === "welcome" && order.welcomeReason === "FIRST_ORDER" && <span className="is-evidence">First order after signup</span>}
                {flowKey === "welcome" && order.welcomeReason === "WELCOME_CODE" ? <span className="is-evidence">Welcome code used</span> : order.discountCodes.length > 0 && <span className="is-evidence">Flow code used</span>}
                <span>{attributionNames[order.interaction] || "Recorded attribution"}</span>
              </div>
              {order.discountCodes.length > 0 && <details className="mk-fr-code"><summary>Flow discount code</summary><p>{order.discountCodes.join(", ")}</p></details>}
            </li>)}
          </ol>}
          {report.ordersPage.pages > 1 && <nav className="mk-fr-pagination" aria-label="Attributed order pages">
            <button type="button" disabled={loading || report.ordersPage.page <= 1}
              onClick={() => setRequest(value => ({ ...value, page: report.ordersPage.page - 1 }))}>Previous orders</button>
            <span>Page {report.ordersPage.page} of {report.ordersPage.pages}</span>
            <button type="button" disabled={loading || report.ordersPage.page >= report.ordersPage.pages}
              onClick={() => setRequest(value => ({ ...value, page: report.ordersPage.page + 1 }))}>Next orders</button>
          </nav>}
        </section>
        <details className="mk-fr-activity"><summary>Recent messages · latest 25</summary>
          {!report.activity.length ? <p>No customer messages recorded yet.</p> : <ol className="mk-fr-message-list">{report.activity.map(message => <li key={message.id}>
            <div><strong>{message.email || "Customer email unavailable"}</strong><span>{statusLabels[message.status] || message.status}</span></div>
            <p>{message.step} · {message.subject}</p>
            {message.triggerAt && <small>Entered {date(message.triggerAt)}</small>}
            <small>{message.sentAt ? "Sent " + date(message.sentAt) : "Scheduled " + date(message.dueAt)}</small>
            {message.error && <p className="mk-fr-message-error">{message.error}</p>}
          </li>)}</ol>}
        </details>
        {report.reasons.length > 0 && <details className="mk-fr-reasons"><summary>Why messages are waiting or stopped</summary><ul>
          {report.reasons.map(item => <li key={item.reason}><span>{item.reason}</span><strong>{number(item.count)}</strong></li>)}
        </ul></details>}
        <p className="mk-fr-caption">Updated {date(report.generatedAt)}. Sends since {date(report.since)}.</p>
      </>}
    </div>
  </dialog>;
}

export default function FlowResults({ flowKey, autoOpen = false, onClose, initialDays = 30 }: {
  flowKey: FlowKey; autoOpen?: boolean; onClose?: () => void; initialDays?: number;
}) {
  const [open, setOpen] = useState(autoOpen);
  return <>
    {!autoOpen && <button type="button" onClick={() => setOpen(true)}>View flow results</button>}
    {open && <ResultsDialog key={flowKey} flowKey={flowKey} initialDays={initialDays}
      close={() => { setOpen(false); onClose?.(); }} />}
  </>;
}
