"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import FlowsWorkspace from "./FlowsWorkspace";
import "./flows.css";
import "./stock.css";
import AudienceWorkspace from "./AudienceWorkspace";
import SettingsWorkspace from "./SettingsWorkspace";
import "./settings.css";
import "./audiences.css";
import {
  Content,
  defaultContent,
  defaultMarketingSettings,
  MarketingSettings,
} from "@/lib/marketing/rules";
import "./marketing.css";

type Resource = {
  id: string;
  key: string;
  kind: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
};
type Profile = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  lists: string[];
  tags: string[];
  consents: { channel: string; status: string; suppressed: boolean }[];
};
type Campaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
  content: Content;
  audience: Record<string, unknown>;
  _count: { messages: number };
};
type Data = {
  health?: {
    unresolved: number;
    inbox: {
      id: string;
      topic: string;
      status: string;
      attempts: number;
      error: string | null;
      createdAt: string;
    }[];
    oldestPending: { dueAt: string; error: string | null } | null;
  };
  profiles: Profile[];
  nextCursor: string | null;
  campaigns: Campaign[];
  resources: Resource[];
  settings: MarketingSettings;
  counts: { profiles: number; mailable: number; suppressions: number };
  setup: Record<string, unknown>;
  revenue: Record<string, number>;
  revenueCapped: boolean;
  eventCounts: { type: string; _count: number }[];
  messageCounts: {
    status: string;
    channel: string;
    campaignId: string | null;
    flowKey: string | null;
    _count: number;
  }[];
};
async function action(body: unknown) {
  const response = await fetch("/api/marketing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const title = (value: string) => value[0].toUpperCase() + value.slice(1);
export default function MarketingDashboard({ tab }: { tab: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);

  const [campaign, setCampaign] = useState<{
    id?: string;
    name: string;
    subject: string;
    content: Content;
    audience: Record<string, unknown>;
  }>({
    name: "",
    subject: "",
    content: defaultContent,
    audience: { openedDays: 365 },
  });
  const [at, setAt] = useState(""),
    [preview, setPreview] = useState(""),
    [mobile, setMobile] = useState(false),
    [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [resource, setResource] = useState<Resource | null>(null),
    [resourceText, setResourceText] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/marketing", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketing", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then((d: Data) => {
        setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function run<T>(
    fn: () => Promise<T>,
    message: string | ((result: T) => string) = "Saved",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      setNotice(typeof message === "function" ? message(result) : message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const update = (key: keyof Content, value: unknown) =>
    setCampaign((c) => ({ ...c, content: { ...c.content, [key]: value } }));
  const save = async () => {
    const r = await action({ action: "save-campaign", ...campaign });
    setCampaign((c) => ({ ...c, id: r.id }));
    return r.id;
  };
  return (
    <section className="marketing">
      <header className="mk-header">
        <div>
          <p className="mk-eyebrow">CORALS ANONYMOUS / OUR KLAVIYO</p>
          <h1>{title(tab)}</h1>
          <p>Your audience, campaigns, and customer journeys in Reef Ops.</p>
        </div>
        <span
          className={`mk-status ${data?.setup.sendingEnabled ? "live" : ""}`}
        >
          {data?.setup.sendingEnabled ? "Sending enabled" : "Sending disabled"}
        </span>
      </header>
      {error && (
        <div className="mk-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mk-notice" role="status">
          {notice}
        </div>
      )}
      {!data ? (
        <p>
          Marketing data will appear after database setup.{" "}
          <button onClick={() => run(load, "Refreshed")}>Retry</button>
        </p>
      ) : (
        <>
          {!data.resources.some((r) => r.kind === "FLOW") && (
            <div className="mk-panel">
              <h2>Set up Our Klaviyo</h2>
              <p>
                Create the five paused flows, standard email template, and
                default audiences.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    () => action({ action: "initialize" }),
                    "Marketing defaults created. Flows remain paused for review.",
                  )
                }
              >
                Create defaults
              </button>
            </div>
          )}
          {(tab === "overview" || tab === "analytics") && (
            <>
              <div className="mk-metrics">
                {Object.entries(data.counts).map(([k, v]) => (
                  <article className="mk-panel" key={k}>
                    <span>{title(k)}</span>
                    <strong>{v.toLocaleString()}</strong>
                  </article>
                ))}
              </div>
              <div className="mk-columns">
                <article className="mk-panel">
                  <h2>Delivery activity</h2>
                  {data.messageCounts.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Channel / source</th>
                          <th>Status</th>
                          <th>Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.messageCounts.map((m, i) => (
                          <tr key={i}>
                            <td>
                              {m.channel}
                              <small>
                                {m.flowKey ||
                                  data.campaigns.find(
                                    (c) => c.id === m.campaignId,
                                  )?.name ||
                                  "Form"}
                              </small>
                            </td>
                            <td>{m.status}</td>
                            <td>{m._count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>No messages yet.</p>
                  )}
                </article>
                <article className="mk-panel">
                  <h2>Engagement & attribution</h2>
                  {data.eventCounts.map((e) => (
                    <p key={e.type}>
                      {e.type} <b>{e._count.toLocaleString()}</b>
                    </p>
                  ))}
                  {Object.entries(data.revenue).map(([currency, amount]) => (
                    <p key={currency}>
                      Attributed order value{" "}
                      <b>
                        {amount.toFixed(2)} {currency}
                      </b>
                    </p>
                  ))}
                  <small>
                    {String(data.setup.attribution)} Opens can include
                    privacy-proxy activity. Event totals are not unique
                    recipient rates. Revenue is gross order value before refund
                    adjustment.
                    {data.revenueCapped &&
                      " Display limited to 10,000 attributed orders."}
                  </small>
                </article>
              </div>
              <article className="mk-panel">
                <h2>Launch readiness</h2>
                <p>
                  Import suppressions and historical engagement, review flow
                  copy and timing, connect providers, and validate a small send
                  before switching off Klaviyo.
                </p>
                <Link href="/our-klaviyo/settings">
                  View setup and migration →
                </Link>
              </article>
            </>
          )}
          {tab === "campaigns" && (
            <div className="mk-columns">
              <article className="mk-panel">
                <h2>
                  {campaign.id ? "Edit campaign draft" : "Create campaign"}
                </h2>
                <label>
                  Campaign name
                  <input
                    value={campaign.name}
                    onChange={(e) =>
                      setCampaign({ ...campaign, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Audience
                  <select
                    value={JSON.stringify(campaign.audience)}
                    onChange={(e) => {
                      setCampaign({
                        ...campaign,
                        audience: JSON.parse(e.target.value),
                      });
                      setAudienceCount(null);
                    }}
                  >
                    <option value={JSON.stringify({ openedDays: 365 })}>
                      Mailable Subscribers · opened in 365 days
                    </option>
                    <option value="{}">All eligible email subscribers</option>
                    {data.resources
                      .filter((r) => r.kind === "SEGMENT")
                      .map((r) => (
                        <option key={r.id} value={JSON.stringify(r.data)}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      async () =>
                        setAudienceCount(
                          (
                            await action({
                              action: "audience-count",
                              audience: campaign.audience,
                            })
                          ).count,
                        ),
                      "Audience checked",
                    )
                  }
                >
                  Check audience
                </button>
                {audienceCount !== null && (
                  <p>
                    {audienceCount.toLocaleString()} currently eligible
                    recipients. Eligibility is checked again at send time.
                  </p>
                )}
                <label>
                  Subject
                  <input
                    value={campaign.subject}
                    onChange={(e) =>
                      setCampaign({ ...campaign, subject: e.target.value })
                    }
                  />
                </label>
                <label>
                  Start from template
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const r = data.resources.find(
                        (r) => r.id === e.target.value,
                      );
                      if (r)
                        setCampaign({
                          ...campaign,
                          content: r.data as unknown as Content,
                        });
                    }}
                  >
                    <option value="">Choose a template</option>
                    {data.resources
                      .filter((r) => r.kind === "TEMPLATE")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                {(
                  [
                    ["preview", "Preview text"],
                    ["heading", "Heading"],
                    ["hero", "Hero image URL"],
                    ["button", "Button label"],
                    ["url", "Button destination"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      value={campaign.content[key] || ""}
                      onChange={(e) => update(key, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  {campaign.content.bodyHtml ? "Message HTML" : "Message"}
                  <textarea
                    rows={6}
                    value={campaign.content.bodyHtml || campaign.content.body}
                    onChange={(e) =>
                      update(
                        campaign.content.bodyHtml ? "bodyHtml" : "body",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <h3>Product cards</h3>
                {(campaign.content.products || []).map((p, i) => (
                  <fieldset key={i}>
                    <legend>Product {i + 1}</legend>
                    {(["title", "url", "image", "price"] as const).map(
                      (key) => (
                        <label key={key}>
                          {title(key)}
                          <input
                            value={p[key] || ""}
                            onChange={(e) =>
                              update(
                                "products",
                                campaign.content.products!.map((v, n) =>
                                  n === i ? { ...v, [key]: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        </label>
                      ),
                    )}
                    <button
                      onClick={() =>
                        update(
                          "products",
                          campaign.content.products!.filter((_, n) => n !== i),
                        )
                      }
                    >
                      Remove product
                    </button>
                  </fieldset>
                ))}
                <button
                  onClick={() =>
                    update("products", [
                      ...(campaign.content.products || []),
                      {
                        title: "",
                        url: "https://coralsanonymous.com",
                        price: "",
                      },
                    ])
                  }
                >
                  Add product
                </button>
                <div className="mk-actions">
                  <button
                    disabled={busy}
                    onClick={() => run(save, "Draft saved")}
                  >
                    Save draft
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () =>
                          setPreview(
                            (
                              await action({
                                action: "preview",
                                content: campaign.content,
                              })
                            ).html,
                          ),
                        "Preview updated",
                      )
                    }
                  >
                    Preview email
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          action({
                            action: "save-resource",
                            kind: "TEMPLATE",
                            name: campaign.name || "Campaign template",
                            data: campaign.content,
                          }),
                        "Reusable template saved",
                      )
                    }
                  >
                    Save as template
                  </button>
                </div>
                <label>
                  Internal test recipient
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !testEmail}
                  onClick={() =>
                    run(
                      () =>
                        action({
                          action: "test-email",
                          to: testEmail,
                          subject: campaign.subject,
                          content: campaign.content,
                        }),
                      "Test email sent",
                    )
                  }
                >
                  Send test email
                </button>
                <label>
                  Send time (your device’s local timezone)
                  <input
                    type="datetime-local"
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !at}
                  onClick={() =>
                    run(async () => {
                      const id = await save();
                      await action({
                        action: "schedule",
                        id,
                        at: new Date(at).toISOString(),
                      });
                      setCampaign({
                        name: "",
                        subject: "",
                        content: defaultContent,
                        audience: { openedDays: 365 },
                      });
                    }, "Campaign scheduled. Sending requires completed setup and an active worker.")
                  }
                >
                  Save and schedule
                </button>
              </article>
              <div>
                {preview && (
                  <article className="mk-panel">
                    <div className="mk-actions">
                      <button onClick={() => setMobile(!mobile)}>
                        {mobile ? "Desktop preview" : "Mobile preview"}
                      </button>
                    </div>
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={preview}
                      style={{
                        width: mobile ? 320 : "100%",
                        maxWidth: "100%",
                        height: 650,
                        background: "white",
                        border: 0,
                      }}
                    />
                  </article>
                )}
                <article className="mk-panel">
                  <h2>Campaigns</h2>
                  {!data.campaigns.length && (
                    <p>Your first campaign starts here.</p>
                  )}
                  {data.campaigns.map((c) => (
                    <div className="mk-row" key={c.id}>
                      <h3>{c.name}</h3>
                      <p>
                        {c.status} · {c._count.messages} messages{" "}
                        {c.scheduledAt &&
                          `· ${new Date(c.scheduledAt).toLocaleString()}`}
                      </p>
                      <div className="mk-actions">
                        {c.status === "DRAFT" && (
                          <button onClick={() => setCampaign(c)}>Edit</button>
                        )}
                        <button
                          onClick={() =>
                            setCampaign({
                              name: `${c.name} copy`,
                              subject: c.subject,
                              content: c.content,
                              audience: c.audience,
                            })
                          }
                        >
                          Duplicate
                        </button>
                        {["DRAFT", "SCHEDULED", "SENDING"].includes(
                          c.status,
                        ) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => action({ action: "cancel", id: c.id }),
                                "Campaign cancelled. Messages already in flight may finish.",
                              )
                            }
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </article>
              </div>
            </div>
          )}
          {tab === "audiences" && (
            <AudienceWorkspace sendingEnabled={!!data.setup.sendingEnabled} />
          )}
          {tab === "flows" && (
            <FlowsWorkspace
              resources={data.resources.filter((r) => r.kind === "FLOW")}
              messageCounts={data.messageCounts}
              setup={data.setup}
              unresolved={data.health?.unresolved}
              settings={data.settings || defaultMarketingSettings}
              busy={busy}
              refresh={() => run(load, "Flow status refreshed")}
              testEmail={(to, subject, content) =>
                run(
                  () => action({ action: "test-email", to, subject, content }),
                  "Flow test email sent",
                )
              }
              save={(resource, flow, enabled) =>
                run(
                  async () =>
                    action({
                      action: "save-resource",
                      kind: "FLOW",
                      key: resource.key,
                      name: resource.name,
                      data: flow,
                      enabled,
                    }),
                  "Flow saved; already queued messages keep their reviewed content.",
                )
              }
            />
          )}
          {tab === "templates" && (
            <>
              <div className="mk-grid">
                {data.resources
                  .filter((r) => r.kind === "TEMPLATE")
                  .map((r) => (
                    <article className="mk-panel" key={r.id}>
                      <span className="mk-status">Reusable</span>
                      <h2>{r.name}</h2>
                      <p>Corals Anonymous email layout</p>
                      <button
                        onClick={() => {
                          setResource(r);
                          setResourceText(JSON.stringify(r.data, null, 2));
                        }}
                      >
                        Review and edit
                      </button>
                    </article>
                  ))}
              </div>
              {resource && (
                <article className="mk-panel">
                  <h2>{resource.name}</h2>
                  <p>
                    Edit reusable content fields. Campaign drafts keep their own
                    copy.
                  </p>
                  <textarea
                    aria-label="Configuration"
                    className="mk-code"
                    rows={22}
                    value={resourceText}
                    onChange={(e) => setResourceText(e.target.value)}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        action({
                          action: "save-resource",
                          ...resource,
                          data: JSON.parse(resourceText),
                        }),
                      )
                    }
                  >
                    Save configuration
                  </button>
                </article>
              )}
            </>
          )}
          {tab === "forms" && (
            <article className="mk-panel">
              <h2>Email → confirmation → optional SMS</h2>
              <p>
                The storefront popup appears after 10 seconds on desktop and
                mobile. Clicking outside dismisses it for 7 days; submitted
                visitors and recognized profiles are suppressed.
              </p>
              <p>
                The first-order offer is 10% off. Email ownership is confirmed
                before welcome messages begin. SMS consent remains separate.
              </p>
              <p>
                Form enabled: <b>{data.setup.formEnabled ? "Yes" : "No"}</b> ·
                Coupon configured:{" "}
                <b>{data.setup.couponReady ? "Yes" : "No"}</b>
              </p>
              <p>
                Install the storefront script and configure the permitted
                storefront origin after testing the signup journey. Instructions
                are in docs/our-klaviyo.md.
              </p>
              <h3>Form activity</h3>
              {data.eventCounts
                .filter((e) => e.type.startsWith("FORM"))
                .map((e) => (
                  <p key={e.type}>
                    {e.type}: {e._count}
                  </p>
                ))}
            </article>
          )}
          {tab === "settings" && (
            <SettingsWorkspace data={data} refresh={load} />
          )}
        </>
      )}
    </section>
  );
}
