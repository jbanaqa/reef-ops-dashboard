import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FlowResults from "../app/our-klaviyo/FlowResults";
import AnalyticsWorkspace from "../app/our-klaviyo/AnalyticsWorkspace";
import type { FlowReport } from "../lib/marketing/flow-report";

declare global {
  interface Window {
    __flowRequests: string[];
    __flowFailure: boolean;
  }
}
const metrics = {
  sent: 100, recipients: 80, delivered: 90, opened: 60, clicked: 0,
  bounced: 4, complained: 1, unsubscribed: 2, waiting: 4, stopped: 3,
  needsAttention: 1, orders: 12, convertedRecipients: 8, revenue: { USD: 1234.56 },
};
const at = "2026-10-19T17:00:00.000Z";
function report(flowKey: "welcome" | "abandoned-cart", days: number, page: number): FlowReport {
  const name = flowKey === "welcome" ? "Welcome" : "Abandoned Cart";
  const orders = Array.from({ length: 3 }, (_, index) => ({
    id: "order-" + (index + 1), label: "#" + (1001 + index),
    shopifyUrl: "https://admin.shopify.com/store/test/orders/" + (1001 + index),
    profileId: "profile-" + index,
    email: index === 0 ? "an-extremely-long-customer-email-that-must-wrap@long-example-domain.test" : "customer" + index + "@example.test",
    placedAt: at, sentAt: "2026-10-18T17:00:00.000Z", subject: name + " offer",
    step: flowKey === "welcome" ? "Email #1 · Welcome offer" : "Email #2 · Discount offer",
    amount: index === 2 ? null : 100 + index, currency: index === 2 ? null : "USD",
    interaction: flowKey === "welcome" && index === 0 ? "COUPON" as const : "OPENED" as const,
    interactedAt: flowKey === "welcome" && index === 0 ? at : "2026-10-19T16:00:00.000Z",
    ...(flowKey === "welcome" ? { welcomeReason: index === 0 ? "WELCOME_CODE" as const : "FIRST_ORDER" as const } : {}),
    checkoutMatch: flowKey === "welcome" ? null : index === 0 ? true : index === 1 ? false : null,
    discountCodes: index === 0 ? ["FLOW-TEST-CODE"] : [],
  }));
  const empty = days === 7;
  return {
    paymentVerification: { unverifiedOrders: empty ? 0 : 2 },
    flowKey, name, days, since: "2026-09-19T17:00:00.000Z", generatedAt: at,
    attribution: { emailClickDays: 5, emailOpenDays: 1 },
    totals: empty ? { ...metrics, revenue: {}, orders: 0, convertedRecipients: 0 } : metrics,
    steps: [{ ...metrics, key: "first", label: name + " first email" }],
    orders: empty ? [] : orders.slice((page - 1) * 2, page * 2),
    ordersPage: { page, pageSize: 2, total: empty ? 0 : 3, pages: empty ? 1 : 2 },
    evidence: { matchingCheckoutOrders: flowKey === "abandoned-cart" ? 1 : 0, discountOrders: 1, missingCheckoutDetails: flowKey === "abandoned-cart" ? 1 : 0 },
    activity: [{ id: "message-1", profileId: "profile-1", email: "queued@example.test", subject: "Queued reminder", step: "First reminder", status: "PENDING", triggerAt: at, sentAt: null, dueAt: at, error: "Waiting for email sending hours" }],
    reasons: [{ reason: "Waiting for email sending hours", count: 4 }],
  };
}
window.__flowRequests = [];
window.__flowFailure = false;
window.fetch = async (input) => {
  const url = String(input), params = new URL(url, location.href).searchParams;
  window.__flowRequests.push(url);
  if (params.get("view") === "analytics") return Response.json({
    paymentVerification: { unverifiedOrders: 2 },
    days: 30, since: at, attribution: { emailClickDays: 5, emailOpenDays: 1 },
    totals: { ...metrics, messages: 100, trackedOrders: 15, storeRevenue: { USD: 1500 } },
    rows: ["welcome", "abandoned-cart"].map(key => ({ ...metrics, key, kind: "FLOW", name: key === "welcome" ? "Welcome" : "Abandoned Cart", messages: 100 })),
  });
  const days = Number(params.get("days") || 30);
  await new Promise(resolve => setTimeout(resolve, days === 90 ? 450 : 15));
  if (window.__flowFailure) return Response.json({ error: "Results temporarily unavailable. Please retry." }, { status: 503 });
  return Response.json(report(params.get("key") === "welcome" ? "welcome" : "abandoned-cart", days, Number(params.get("ordersPage") || 1)));
};
function App() {
  const [analytics, setAnalytics] = useState(false);
  return <main className="marketing" style={{ padding: 24 }}>
    <h1>Flow results fixture</h1>
    <section aria-label="Welcome results"><h2>Welcome</h2><FlowResults flowKey="welcome" /></section>
    <section aria-label="Cart results"><h2>Abandoned Cart</h2><FlowResults flowKey="abandoned-cart" /></section>
    <button type="button" onClick={() => setAnalytics(value => !value)}>Show analytics</button>
    {analytics && <AnalyticsWorkspace />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
