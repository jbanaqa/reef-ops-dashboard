"use client";
import { useMarketingBrand } from "./MarketingBrand";
import { useEffect, useState } from "react";
import { welcomeLabels } from "@/lib/marketing/welcome-config";

type Message = { id: string; flowStep: number | null; status: string; dueAt: string; sentAt: string | null; error: string | null; events: { type: string; occurredAt: string }[] };
type Report = {
  liveSince: string | null;
  totals: { joined: number; sent: number; waiting: number; attention: number };
  rows: { id: string; triggeredAt: string; signupAt: string; profile: { id: string; name: string; email: string | null } | null; messages: Message[] }[];
  nextCursor: string | null;
};
const date = (value: string) => new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short",
});
const status = (message?: Message) => !message ? "No message recorded"
  : message.events.some((event) => event.type === "BOUNCED") ? "Bounced"
  : message.events.some((event) => event.type === "COMPLAINED") ? "Spam complaint"
  : message.status === "SENT" ? message.events.some((event) => event.type === "DELIVERED") ? "Delivered" : "Sent"
  : ({ PENDING: "Queued", SENDING: "Sending", CANCELLED: "Skipped", FAILED: "Failed", UNKNOWN: "Needs review" }[message.status] || message.status);
const eventNames: Record<string, string> = { DELIVERED: "Delivered", OPENED: "Opened", CLICKED: "Clicked", BOUNCED: "Bounced", COMPLAINED: "Spam complaint", UNSUBSCRIBED: "Unsubscribed" };

export default function WelcomeActivity() {
  const { marketingFetch } = useMarketingBrand();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("live");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [version, setVersion] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cursor = pages[pages.length - 1];
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      setReport(null);
      try {
        const params = new URLSearchParams({ view: "welcome-activity", scope, q: query });
        if (cursor) params.set("cursor", cursor);
        const response = await marketingFetch("/api/marketing?" + params, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Could not load Welcome activity.");
        if (!controller.signal.aborted) setReport(result);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load activity.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, scope, query, cursor, version, marketingFetch]);
  return <details className="fw-welcome-activity" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Welcome activity <span>Signups and message history</span></summary>
    {open && <div>
      <div className="fw-welcome-toolbar">
        <label>Search customers<input type="search" placeholder="Name or email" value={query} onChange={(event) => { setQuery(event.target.value); setPages([null]); }} /></label>
        <label>Show<select aria-label="Activity period" value={scope} onChange={(event) => { setScope(event.target.value); setPages([null]); }}>
          <option value="live">Since activation</option><option value="all">All customer signups</option>
        </select></label>
        <button disabled={loading} onClick={() => setVersion((value) => value + 1)}>{loading ? "Loading…" : "Refresh activity"}</button>
      </div>
      <p className="fw-welcome-caption">{report?.liveSince ? "Activated " + date(report.liveSince) + ". " : ""}Times in Pacific time. Test enrollments are excluded.</p>
      {error && <p role="alert">{error} <button onClick={() => { setPages([null]); setVersion((value) => value + 1); }}>Try again</button></p>}
      {loading && <p role="status">Loading activity…</p>}
      {report && <>
        <dl className="fw-welcome-stats">
          {[["Joined", report.totals.joined], ["Welcome sent", report.totals.sent], ["Welcome queued", report.totals.waiting], ["Needs attention", report.totals.attention]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}
        </dl>
        {!report.rows.length && <p role="status">{scope === "live" && !report.liveSince ? "Activation time is not recorded. Choose All customer signups to see history." : "No customer Welcome signups match this view yet."}</p>}
        <div className="fw-welcome-entries">
          {report.rows.map((row) => <details key={row.id} className="fw-welcome-entry">
            <summary>
              <span><strong>{row.profile?.email || row.profile?.name || "Customer profile unavailable"}</strong>{row.profile?.name && <span>{row.profile.name}</span>}</span>
              <time dateTime={row.triggeredAt}>Entered {date(row.triggeredAt)}</time>
              <span className="fw-welcome-message-status">{status(row.messages.find((message) => message.flowStep === 0))}</span>
            </summary>
            <p className="fw-welcome-caption">Signup recorded {date(row.signupAt)}</p>
            <ol className="fw-welcome-messages">
              {row.messages.map((message) => <li key={message.id}>
                <div><strong>{welcomeLabels[message.flowStep ?? -1] || "Welcome message"}</strong><span>{status(message)}</span></div>
                <p>{message.sentAt ? "Sent " + date(message.sentAt) : "Scheduled " + date(message.dueAt)}</p>
                {message.events.map((event) => <p key={event.type}>{eventNames[event.type]} {date(event.occurredAt)}</p>)}
                {message.error && <p className="fw-attention">{message.error}</p>}
              </li>)}
            </ol>
          </details>)}
        </div>
        <div className="fw-welcome-pagination">
          <span>{report.totals.joined.toLocaleString()} matching signups</span>
          <button disabled={loading || pages.length === 1} onClick={() => setPages((value) => value.slice(0, -1))}>Previous</button>
          <button disabled={loading || !report.nextCursor} onClick={() => setPages((value) => [...value, report.nextCursor])}>Next</button>
        </div>
      </>}
    </div>}
  </details>;
}
