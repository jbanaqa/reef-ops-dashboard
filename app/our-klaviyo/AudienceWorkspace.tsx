"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Segment } from "@/lib/marketing/rules";

type Consent = {
  channel: string;
  status: string;
  suppressed: boolean;
  source?: string;
  occurredAt?: string;
  reason?: string | null;
};
type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  lists: string[];
  consents: Consent[];
  createdAt: string;
  lastOpenedAt: string | null;
  lastOrderAt: string | null;
};
type Group = { id?: string; key: string; name: string; data: Segment };
type Message = {
  testSend?: { canSendNow: boolean; reason: string | null };
  id: string;
  subject: string;
  status: string;
  channel: string;
  flowKey: string | null;
  dueAt: string;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
};
type Activity = {
  id: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};
type Detail = Contact & { events: Activity[]; messages: Message[] };
type Directory = {
  profiles: Contact[];
  groups: Group[];
  total: number;
  nextCursor: string | null;
};
const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";
const title = (c: Contact) =>
  c.name.trim() || c.email || c.phone || "Unnamed contact";
export function emailStatus(
  c: Pick<Contact, "consents" | "email">,
  channel = "EMAIL",
) {
  const consent = c.consents.find((x) => x.channel === channel);
  if (consent?.status === "UNSUBSCRIBED")
    return { label: "Unsubscribed", tone: "muted" };
  if (consent?.suppressed) return { label: "Blocked", tone: "warning" };
  if (channel === "EMAIL" && !c.email)
    return { label: "No email address", tone: "muted" };
  if (consent?.status === "SUBSCRIBED")
    return { label: "Subscribed", tone: "good" };
  return { label: "Not subscribed", tone: "muted" };
}
export function audienceRules(s: Segment) {
  return [
    "Subscribed to email and not blocked",
    s.tag && "Tagged “" + s.tag + "”",
    s.list && "In list “" + s.list + "”",
    s.openedDays && "Opened an email in the last " + s.openedDays + " days",
    s.purchasedDays && "Purchased in the last " + s.purchasedDays + " days",
    s.excludePurchasedDays &&
      "No purchases in the last " + s.excludePurchasedDays + " days",
  ].filter(Boolean) as string[];
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
const post = <T,>(body: unknown) =>
  request<T>("/api/marketing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function Badge({ contact, channel }: { contact: Contact; channel?: string }) {
  const status = emailStatus(contact, channel);
  return <span className={"aw-badge " + status.tone}>{status.label}</span>;
}
function Panel({
  heading,
  close,
  children,
}: {
  heading: string;
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
      className="aw-drawer"
      aria-label={heading}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="aw-drawer-header">
        <div>
          <p className="aw-eyebrow">AUDIENCES</p>
          <h2>{heading}</h2>
        </div>
        <button type="button" onClick={close} aria-label="Close panel">
          ✕
        </button>
      </div>
      <div className="aw-drawer-body">{children}</div>
    </dialog>
  );
}
const messageStatus: Record<string, string> = {
  PENDING: "Scheduled",
  PROCESSING: "Processing",
  SENDING: "Sending",
  SENT: "Sent",
  CANCELLED: "Not sent",
  FAILED: "Failed",
  UNKNOWN: "Delivery uncertain",
};
const flowName: Record<string, string> = {
  "b2b-welcome": "B2B welcome",
  welcome: "Welcome",
  "abandoned-cart": "Cart reminder",
  "post-purchase": "After purchase",
  "low-stock": "Low stock",
};
function eventLabel(e: Activity) {
  const p = e.payload;
  if (e.type === "CONSENT") {
    const channel = p.channel === "EMAIL" ? "Email" : "Text message";
    if (p.ignored)
      return channel + " preference update received (older update ignored)";
    return (
      channel +
      (p.status === "SUBSCRIBED"
        ? " subscription recorded"
        : p.status === "UNSUBSCRIBED"
          ? " unsubscribe recorded"
          : " not subscribed")
    );
  }
  if (/tags_added|tags_removed/.test(e.type))
    return (
      (e.type.endsWith("tags_added") ? "Tags added: " : "Tags removed: ") +
      (Array.isArray(p.tags) ? p.tags.join(", ") : "Shopify tags updated")
    );
  const labels: Record<string, string> = {
    "customers/create": "Customer created in Shopify",
    "customers/update": "Customer details synced from Shopify",
    OPENED: "Email opened",
    CLICKED: "Email link clicked",
    ORDER: "Order recorded",
    DELIVERED: "Email delivered",
    CART_TEST_SEND_REQUESTED: "Early delivery requested for a test email",
    BOUNCED: "Email bounced",
    COMPLAINED: "Spam complaint received",
    UNSUBSCRIBED: "Unsubscribed",
    "checkouts/create": "Checkout started",
    "checkouts/update": "Checkout updated",
  };
  return labels[e.type] || "Customer activity recorded";
}
function ContactPanel({
  id,
  close,
  changed,
  sendingEnabled,
}: {
  id: string;
  close: () => void;
  changed: () => void;
  sendingEnabled: boolean;
}) {
  const [contact, setContact] = useState<Detail | null>(null);
  const [section, setSection] = useState("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    request<{ profile: Detail | null }>(
      "/api/marketing?view=contact&id=" + encodeURIComponent(id),
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) {
          if (!r.profile) throw new Error("This contact could not be found.");
          setContact(r.profile);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, version]);
  function refresh() {
    setLoading(true);
    setError("");
    setVersion((v) => v + 1);
  }
  async function block() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await post({ action: "suppress", id, channel: confirm });
      setConfirm(null);
      setNoticeSuccess(true);
      setNotice(
        "Marketing messages blocked for this channel. Pending messages were cancelled.",
      );
      refresh();
      changed();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update preferences.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendStepNow(messageId: string) {
    setBusy(true);
    setSendingId(messageId);
    setError("");
    setNotice("");
    try {
      const result = await post<{ status: string; message: string }>({
        action: "send-cart-test-now",
        profileId: id,
        messageId,
      });
      setNoticeSuccess(result.status === "SENT");
      setNotice(result.message);
      refresh();
      changed();
    } catch (e) {
      refresh();
      setError(
        e instanceof Error ? e.message : "Could not send this test step.",
      );
    } finally {
      setBusy(false);
      setSendingId(null);
    }
  }
  return (
    <Panel heading={contact ? title(contact) : "Contact details"} close={close}>
      {error && (
        <div role="alert" className="aw-alert">
          {error}
          <button onClick={() => refresh()}>Try again</button>
        </div>
      )}
      {notice && (
        <p role="status" className={noticeSuccess ? "aw-success" : "aw-hint"}>
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading contact…</p>}
      {contact && (
        <>
          <div className="aw-identity">
            <span className="aw-avatar">
              {title(contact).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{contact.email || "No email address"}</strong>
              <p>{contact.phone || "No phone number"}</p>
              <Badge contact={contact} />
            </div>
          </div>
          <nav className="aw-tabs" aria-label="Contact sections">
            {["overview", "emails", "activity"].map((s) => (
              <button
                key={s}
                aria-current={section === s ? "page" : undefined}
                onClick={() => setSection(s)}
              >
                {s === "overview"
                  ? "Overview"
                  : s === "emails"
                    ? "Messages"
                    : "Activity"}
              </button>
            ))}
            <button
              className="aw-refresh"
              disabled={loading || busy}
              onClick={() => refresh()}
            >
              Refresh
            </button>
          </nav>
          {section === "overview" && (
            <>
              <section className="aw-detail-section">
                <h3>Marketing preferences</h3>
                <p>Subscriptions are separate for email and text messages.</p>
                {["EMAIL", "SMS_MARKETING"].map((channel) => {
                  const c = contact.consents.find((x) => x.channel === channel);
                  return (
                    <div className="aw-preference" key={channel}>
                      <div>
                        <strong>
                          {channel === "EMAIL"
                            ? "Email marketing"
                            : "Text marketing"}
                        </strong>
                        <p>
                          {c
                            ? (c.source === "shopify"
                                ? "Synced from Shopify"
                                : "Preference recorded") +
                              " · " +
                              date(c.occurredAt)
                            : "No subscription recorded"}
                        </p>
                        {c?.reason && <p>{c.reason}</p>}
                      </div>
                      <Badge contact={contact} channel={channel} />
                    </div>
                  );
                })}
                <p className="aw-hint">
                  A subscription alone does not send an email. Workflow rules
                  and sending settings still apply.
                </p>
              </section>
              <section className="aw-detail-section">
                <h3>Tags</h3>
                <div className="aw-tags">
                  {contact.tags.length ? (
                    contact.tags.map((t) => <span key={t}>{t}</span>)
                  ) : (
                    <p>No tags yet.</p>
                  )}
                </div>
                <p>
                  Manage customer tags in Shopify. Changes appear after syncing.
                </p>
                {contact.lists.length > 0 && (
                  <>
                    <h3>Lists</h3>
                    <div className="aw-tags">
                      {contact.lists.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </section>
              <section className="aw-detail-section">
                <h3>At a glance</h3>
                <dl className="aw-facts">
                  <div>
                    <dt>Added to Reef Ops</dt>
                    <dd>{date(contact.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Last recorded email open</dt>
                    <dd>{date(contact.lastOpenedAt)}</dd>
                  </div>
                  <div>
                    <dt>Last recorded order</dt>
                    <dd>{date(contact.lastOrderAt)}</dd>
                  </div>
                </dl>
              </section>
              <details className="aw-manage">
                <summary>Manage marketing preferences</summary>
                <p>
                  Block a channel to stop future marketing and cancel pending
                  messages. This cannot be undone here. Messages already sending
                  may still arrive.
                </p>
                {["EMAIL", "SMS_MARKETING"].map((channel) => (
                  <button
                    key={channel}
                    disabled={
                      busy ||
                      loading ||
                      !!contact.consents.find((c) => c.channel === channel)
                        ?.suppressed
                    }
                    onClick={() => setConfirm(channel)}
                  >
                    Block {channel === "EMAIL" ? "email" : "text"} marketing
                  </button>
                ))}
                {confirm && (
                  <div className="aw-confirm">
                    <strong>
                      Block {confirm === "EMAIL" ? "email" : "text"} marketing
                      for this contact?
                    </strong>
                    <div>
                      <button disabled={busy} onClick={block}>
                        {busy ? "Blocking…" : "Confirm block"}
                      </button>
                      <button disabled={busy} onClick={() => setConfirm(null)}>
                        Keep current preference
                      </button>
                    </div>
                  </div>
                )}
              </details>
            </>
          )}
          {section === "emails" && (
            <section className="aw-detail-section">
              <h3>Message history</h3>
              {contact.messages.some((m) => m.testSend) && (
                <p className="aw-hint">
                  Restricted cart test · Send a selected email to this account
                  now. Only its wait is bypassed; consent, purchase and
                  recent-email checks still apply.
                </p>
              )}
              {!sendingEnabled && (
                <p className="aw-hint">
                  Sending is currently off. Scheduled messages will not send
                  until sending is enabled and all checks pass.
                </p>
              )}
              {contact.messages.length === 0 ? (
                <div className="aw-empty">
                  <h3>No workflow messages yet</h3>
                  <p>
                    No messages have been scheduled for this contact. Internal
                    preview emails are not listed here.
                  </p>
                </div>
              ) : (
                contact.messages.map((m) => (
                  <article className="aw-message" key={m.id}>
                    <div className="aw-split">
                      <span className="aw-eyebrow">
                        {m.flowKey
                          ? flowName[m.flowKey] || "Automation"
                          : "Campaign / signup"}{" "}
                        · {m.channel === "EMAIL" ? "EMAIL" : "TEXT"}
                      </span>
                      <span
                        className={
                          "aw-badge " +
                          (m.status === "SENT"
                            ? "good"
                            : m.status === "FAILED" || m.status === "UNKNOWN"
                              ? "warning"
                              : "muted")
                        }
                      >
                        {messageStatus[m.status] || m.status}
                      </span>
                    </div>
                    <h4>{m.subject || "Untitled message"}</h4>
                    <p>
                      {m.sentAt
                        ? "Sent " + date(m.sentAt)
                        : m.status === "PENDING"
                          ? "Scheduled for " + date(m.dueAt)
                          : "Created " + date(m.createdAt)}
                    </p>
                    {m.testSend && (
                      <div className="aw-test-send">
                        <button
                          type="button"
                          disabled={
                            busy ||
                            loading ||
                            !sendingEnabled ||
                            !m.testSend.canSendNow
                          }
                          onClick={() => sendStepNow(m.id)}
                        >
                          {sendingId === m.id
                            ? "Checking and sending…"
                            : "Send this step now"}
                        </button>
                        {m.testSend.reason && <p>{m.testSend.reason}</p>}
                      </div>
                    )}
                    {m.error && (
                      <p className="aw-reason">
                        {m.error === "Not eligible for this channel"
                          ? "Not sent because the contact did not meet the channel's subscription requirements."
                          : m.error === "B2B tag removed"
                            ? "Not sent because the B2B tag was removed."
                            : m.error}
                      </p>
                    )}
                  </article>
                ))
              )}
              {contact.messages.length === 100 && (
                <p>Showing the 100 most recent messages.</p>
              )}
            </section>
          )}
          {section === "activity" && (
            <section className="aw-detail-section">
              <h3>Recent activity</h3>
              {contact.events.length ? (
                <ol className="aw-timeline">
                  {contact.events.map((e) => (
                    <li key={e.id}>
                      <strong>{eventLabel(e)}</strong>
                      <time dateTime={e.occurredAt}>{date(e.occurredAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="aw-empty">
                  <p>No activity recorded yet.</p>
                </div>
              )}
              {contact.events.length === 100 && (
                <p>Showing the 100 most recent events.</p>
              )}
            </section>
          )}
        </>
      )}
    </Panel>
  );
}
function GroupEditor({
  group,
  close,
  saved,
}: {
  group: Group;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [rules, setRules] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(group.data).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (discard) discardRef.current?.focus();
  }, [discard]);
  const data: Segment = Object.fromEntries(
    Object.entries(rules)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, k.endsWith("Days") ? Number(v) : v.trim()]),
  );
  function dismiss() {
    if (dirty) setDiscard(true);
    else close();
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <Panel
      heading={group.id ? "Edit saved audience" : "Create an audience"}
      close={() => {
        if (!busy) dismiss();
      }}
    >
      <p className="aw-intro">
        A saved audience is a group that updates automatically as customers meet
        your rules. Saving one does not send a campaign.
      </p>
      {error && (
        <p role="alert" className="aw-alert">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post({
              action: "save-resource",
              kind: "SEGMENT",
              key: group.key,
              name: name.trim(),
              data,
            });
            saved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save audience.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="aw-form-fields">
          <label>
            Audience name
            <input
              required
              maxLength={200}
              value={name}
              placeholder="e.g. Wholesale subscribers"
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="aw-rule-base">
            <strong>Email subscribers only</strong>
            <p>Unsubscribed and blocked contacts are always excluded.</p>
          </div>
          <h3>
            Narrow this group <span className="aw-optional">Optional</span>
          </h3>
          <p>
            Leave a field blank to include everyone for that rule. All selected
            rules must match.
          </p>
          {[
            ["tag", "Shopify tag", "e.g. b2b"],
            ["list", "Imported list", "Exact list name"],
            ["openedDays", "Opened an email within (days)", "e.g. 365"],
            ["purchasedDays", "Purchased within (days)", "e.g. 30"],
            [
              "excludePurchasedDays",
              "Exclude purchases within (days)",
              "e.g. 7",
            ],
          ].map(([key, label, placeholder]) => (
            <label key={key}>
              {label}
              <input
                type={key.endsWith("Days") ? "number" : "text"}
                min={key.endsWith("Days") ? 1 : undefined}
                max={key.endsWith("Days") ? 3650 : undefined}
                step={key.endsWith("Days") ? 1 : undefined}
                placeholder={placeholder}
                value={rules[key] || ""}
                onChange={(e) => {
                  setRules((r) => ({ ...r, [key]: e.target.value }));
                  setDirty(true);
                }}
              />
            </label>
          ))}
          <div className="aw-rule-summary">
            <strong>Who will be included</strong>
            <ul>
              {audienceRules(data).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <button className="aw-primary" type="submit" disabled={!name.trim()}>
            {busy ? "Saving…" : "Save audience"}
          </button>
        </fieldset>
      </form>
      {discard && (
        <div className="aw-confirm" role="alert" ref={discardRef} tabIndex={-1}>
          <strong>Discard your unsaved audience changes?</strong>
          <button onClick={close}>Discard changes</button>
          <button onClick={() => setDiscard(false)}>Continue editing</button>
        </div>
      )}
    </Panel>
  );
}
export default function AudienceWorkspace({
  sendingEnabled,
}: {
  sendingEnabled: boolean;
}) {
  const [view, setView] = useState("contacts");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [b2b, setB2b] = useState(false);
  const [groupKey, setGroupKey] = useState("");
  const [pages, setPages] = useState<string[]>([""]);
  const [data, setData] = useState<Directory | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Group | null>(null);
  const [notice, setNotice] = useState("");
  const cursor = pages[pages.length - 1];
  const requestKey = new URLSearchParams({
    view: "audience",
    q: query,
    status,
    b2b: String(b2b),
    group: groupKey,
    cursor,
    refresh: String(version),
  }).toString();
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setError("");
      request<Directory>("/api/marketing?" + requestKey, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!controller.signal.aborted) setData(r);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadedKey(requestKey);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey]);
  function reset() {
    setQuery("");
    setStatus("all");
    setB2b(false);
    setGroupKey("");
    setPages([""]);
  }
  const group = data?.groups.find((g) => g.key === groupKey);
  return (
    <div className="aw-workspace">
      <div className="aw-topline">
        <nav className="aw-tabs" aria-label="Audience views">
          <button
            aria-current={view === "contacts" ? "page" : undefined}
            onClick={() => setView("contacts")}
          >
            Contacts
          </button>
          <button
            aria-current={view === "groups" ? "page" : undefined}
            onClick={() => setView("groups")}
          >
            Saved audiences
          </button>
        </nav>
        <button
          className="aw-primary"
          onClick={() =>
            setEditor({ key: crypto.randomUUID(), name: "", data: {} })
          }
        >
          + Create audience
        </button>
      </div>
      {notice && (
        <p role="status" className="aw-success">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="aw-alert">
          {error}
          <button onClick={() => setVersion((v) => v + 1)}>Try again</button>
          <button onClick={reset}>Reset filters</button>
        </div>
      )}
      {view === "contacts" ? (
        <section className="aw-directory">
          <div className="aw-directory-heading">
            <div>
              <p className="aw-eyebrow">YOUR CUSTOMER DIRECTORY</p>
              <h2>{group ? group.name : "All contacts"}</h2>
              <p>
                {group
                  ? audienceRules(group.data).join(" · ")
                  : "Find a customer, check their subscription, and follow their activity."}
              </p>
            </div>
            <button disabled={loading} onClick={() => setVersion((v) => v + 1)}>
              Refresh
            </button>
          </div>
          <div className="aw-toolbar">
            <label className="aw-search">
              Search contacts
              <input
                type="search"
                placeholder="Search name, email, or phone"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPages([""]);
                }}
              />
            </label>
            <label>
              Email status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPages([""]);
                }}
              >
                <option value="all">Any status</option>
                <option value="subscribed">Subscribed</option>
                <option value="not-subscribed">Not subscribed</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="blocked">Blocked from sending</option>
              </select>
            </label>
            <label className="aw-toggle">
              <input
                type="checkbox"
                checked={b2b}
                onChange={(e) => {
                  setB2b(e.target.checked);
                  setPages([""]);
                }}
              />
              B2B customers
            </label>
          </div>
          <div className="aw-list-meta">
            <span role="status">
              {loading
                ? "Loading contacts…"
                : data
                  ? data.total.toLocaleString() + " matching contacts"
                  : ""}
            </span>
            <div>
              {(query || status !== "all" || b2b || groupKey) && (
                <button onClick={reset}>Clear filters</button>
              )}
              <span>Newest added first</span>
            </div>
          </div>
          {!error && (
            <div
              aria-busy={loading}
              className={loading ? "aw-list aw-loading" : "aw-list"}
            >
              {data?.profiles.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Contact</th>
                      <th>Email status</th>
                      <th>Tags</th>
                      <th>
                        <span className="aw-sr-only">View contact</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.profiles.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="aw-contact-button"
                            disabled={loading}
                            onClick={() => setSelected(c.id)}
                          >
                            <span className="aw-avatar">
                              {title(c).slice(0, 1).toUpperCase()}
                            </span>
                            <span>
                              <strong>{title(c)}</strong>
                              <small>
                                {c.name
                                  ? c.email || c.phone || "No contact details"
                                  : "View contact details"}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <Badge contact={c} />
                        </td>
                        <td>
                          <div className="aw-tags">
                            {c.tags.slice(0, 2).map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                            {c.tags.length > 2 && (
                              <span title={c.tags.slice(2).join(", ")}>
                                +{c.tags.length - 2}
                              </span>
                            )}
                            {!c.tags.length && (
                              <span className="aw-no-tag">No tags</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <button
                            aria-label={"View " + title(c)}
                            disabled={loading}
                            onClick={() => setSelected(c.id)}
                          >
                            View →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                !loading && (
                  <div className="aw-empty">
                    <span className="aw-empty-symbol">◎</span>
                    <h3>
                      {query || status !== "all" || b2b || groupKey
                        ? "No contacts match these filters"
                        : "Your contacts will appear here"}
                    </h3>
                    <p>
                      {query || status !== "all" || b2b || groupKey
                        ? "Try a different search or clear your filters."
                        : "Customers appear after Shopify events are processed or contacts are imported."}
                    </p>
                    {query || status !== "all" || b2b || groupKey ? (
                      <button onClick={reset}>Clear filters</button>
                    ) : (
                      <Link href="/our-klaviyo/settings">
                        Open sync settings →
                      </Link>
                    )}
                  </div>
                )
              )}
            </div>
          )}
          <footer className="aw-pagination">
            <span>
              {data && !loading
                ? data.total
                  ? "Showing " +
                    ((pages.length - 1) * 25 + 1) +
                    "–" +
                    ((pages.length - 1) * 25 + data.profiles.length) +
                    " of " +
                    data.total
                  : "0 contacts"
                : "25 contacts per page"}
            </span>
            <div>
              <button
                disabled={loading || pages.length === 1}
                onClick={() => setPages((p) => p.slice(0, -1))}
              >
                ← Previous
              </button>
              <button
                disabled={loading || !!error || !data?.nextCursor}
                onClick={() => {
                  if (data?.nextCursor)
                    setPages((p) => [...p, data.nextCursor!]);
                }}
              >
                Next →
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <section className="aw-groups">
          <div className="aw-directory-heading">
            <div>
              <p className="aw-eyebrow">GROUPS THAT STAY UP TO DATE</p>
              <h2>Saved audiences</h2>
              <p>
                Reusable groups for targeted email campaigns. Membership updates
                automatically as customer details change.
              </p>
            </div>
          </div>
          <div className="aw-group-grid">
            {data?.groups.map((g) => (
              <article className="aw-group-card" key={g.key}>
                <span className="aw-group-icon">◎</span>
                <h3>{g.name}</h3>
                <ul>
                  {audienceRules(g.data).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="aw-group-actions">
                  <button
                    className="aw-primary"
                    onClick={() => {
                      reset();
                      setGroupKey(g.key);
                      setView("contacts");
                    }}
                  >
                    View contacts
                  </button>
                  <button
                    aria-label={"Edit " + g.name}
                    onClick={() => setEditor(g)}
                  >
                    Edit rules
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!loading && !data?.groups.length && (
            <div className="aw-empty">
              <h3>Create your first audience</h3>
              <p>Start with a group such as email subscribers tagged B2B.</p>
              <button
                onClick={() =>
                  setEditor({
                    key: crypto.randomUUID(),
                    name: "B2B subscribers",
                    data: { tag: "b2b" },
                  })
                }
              >
                Create B2B audience
              </button>
            </div>
          )}
          <p className="aw-hint">
            These groups include email subscribers only. Use Contacts to find
            anyone, including unsubscribed customers. Creating or editing a
            group does not change anyone’s subscription.
          </p>
        </section>
      )}
      {selected && (
        <ContactPanel
          key={selected}
          id={selected}
          close={() => setSelected(null)}
          changed={() => setVersion((v) => v + 1)}
          sendingEnabled={sendingEnabled}
        />
      )}
      {editor && (
        <GroupEditor
          key={editor.key}
          group={editor}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setVersion((v) => v + 1);
            setNotice("Audience saved. Its contacts update automatically.");
          }}
        />
      )}
    </div>
  );
}
