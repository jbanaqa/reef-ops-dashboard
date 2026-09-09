"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import FlowEditor from "./FlowEditor";
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
  const [query, setQuery] = useState(""),
    [cursor, setCursor] = useState(""),
    [profile, setProfile] = useState<unknown>(null);
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
    [resourceText, setResourceText] = useState(""),
    [importText, setImportText] = useState("[]"),
    [importResult, setImportResult] = useState<unknown>(null);
  const [settingsForm, setSettingsForm] = useState<MarketingSettings>(
      defaultMarketingSettings,
    ),
    [shopifyWebhookResult, setShopifyWebhookResult] = useState<unknown>(null);
  const load = useCallback(async () => {
    const r = await fetch(
      `/api/marketing?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`,
      { cache: "no-store" },
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }, [query, cursor]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/marketing?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then((d: Data) => {
        setData(d);
        setSettingsForm(d.settings || defaultMarketingSettings);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query, cursor]);
  async function run(fn: () => Promise<unknown>, message = "Saved") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice(message);
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
            <>
              <article className="mk-panel">
                <h2>Profiles and channel consent</h2>
                <label>
                  Search by name or email
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCursor("");
                    }}
                  />
                </label>
                <div className="mk-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Consent</th>
                        <th>Lists / tags</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.profiles.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.name || p.email || p.phone}
                            <small>
                              {p.email}
                              <br />
                              {p.phone}
                            </small>
                          </td>
                          <td>
                            {p.consents.map((c) => (
                              <small key={c.channel}>
                                {c.channel}:{" "}
                                {c.suppressed ? "SUPPRESSED" : c.status}
                              </small>
                            ))}
                          </td>
                          <td>{[...p.lists, ...p.tags].join(", ")}</td>
                          <td>
                            <button
                              onClick={async () => {
                                setBusy(true);
                                setError("");
                                setNotice("");
                                try {
                                  const r = await fetch(
                                    `/api/marketing?view=profile&id=${p.id}`,
                                  );
                                  const result = await r.json();
                                  if (!r.ok)
                                    throw new Error(
                                      result.error ||
                                        "Profile history is unavailable.",
                                    );
                                  setProfile(
                                    result.profile || { notFound: true },
                                  );
                                  setNotice("Profile loaded");
                                } catch (e) {
                                  setError(
                                    e instanceof Error
                                      ? e.message
                                      : "Profile history is unavailable.",
                                  );
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              View history
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () =>
                                    action({
                                      action: "suppress",
                                      id: p.id,
                                      channel: "EMAIL",
                                    }),
                                  "Email suppressed",
                                )
                              }
                            >
                              Suppress email
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () =>
                                    action({
                                      action: "suppress",
                                      id: p.id,
                                      channel: "SMS_MARKETING",
                                    }),
                                  "SMS suppressed",
                                )
                              }
                            >
                              Suppress SMS
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mk-actions">
                  <button onClick={() => setCursor("")}>First page</button>
                  {data.nextCursor && (
                    <button onClick={() => setCursor(data.nextCursor!)}>
                      Next 100
                    </button>
                  )}
                </div>
              </article>
              {profile !== null && (
                <article className="mk-panel">
                  <h2>Profile history</h2>
                  <button onClick={() => setProfile(null)}>Close</button>
                  {(profile as { notFound?: boolean })?.notFound ? (
                    <p>Profile not found in the marketing database.</p>
                  ) : (
                    <pre>{JSON.stringify(profile, null, 2)}</pre>
                  )}
                </article>
              )}
              <article className="mk-panel">
                <h2>Dynamic audiences</h2>
                <p>
                  Every audience also requires current channel consent and no
                  suppression. Static lists are assigned through imports.
                </p>
                {data.resources
                  .filter((r) => r.kind === "SEGMENT")
                  .map((r) => (
                    <div className="mk-row" key={r.id}>
                      <strong>{r.name}</strong>
                      <p>{JSON.stringify(r.data)}</p>
                    </div>
                  ))}
                <AudienceForm
                  busy={busy}
                  save={(name, data) =>
                    run(() =>
                      action({
                        action: "save-resource",
                        kind: "SEGMENT",
                        name,
                        data,
                      }),
                    )
                  }
                />
              </article>
            </>
          )}
          {tab === "flows" && (
            <>
              <div className="mk-grid">
                {data.resources
                  .filter((r) => r.kind === "FLOW")
                  .map((r) => (
                    <article className="mk-panel mk-flow-card" key={r.id}>
                      <div className="mk-flow-card-header">
                        <span className="mk-status">
                          {r.enabled ? "Enabled" : "Paused"}
                        </span>
                        <span className="mk-flow-trigger-label">
                          {String(
                            (r.data as { trigger?: string }).trigger ||
                              "Automation",
                          )}
                        </span>
                      </div>
                      <h2>{r.name}</h2>
                      <p>
                        {String(
                          r.data.description ||
                            "Review this automation before enabling it.",
                        )}
                      </p>
                      <button
                        onClick={() => {
                          setResource(r);
                          setResourceText(JSON.stringify(r.data, null, 2));
                        }}
                      >
                        View workflow
                      </button>
                    </article>
                  ))}
              </div>
              {resource && (
                <>
                  <div className="mk-flow-selected">
                    <div>
                      <p className="mk-eyebrow">SELECTED WORKFLOW</p>
                      <h2>{resource.name}</h2>
                      <p>
                        Select a node below to understand the path, then use the
                        editor to change its settings.
                      </p>
                    </div>
                    <button onClick={() => setResource(null)}>
                      Close workflow
                    </button>
                  </div>
                  <FlowEditor
                    key={resource.id}
                    resource={resource}
                    busy={busy}
                    testEmail={(to, subject, content) =>
                      run(
                        () =>
                          action({
                            action: "test-email",
                            to,
                            subject,
                            content,
                          }),
                        "Flow test email sent",
                      )
                    }
                    settings={data.settings || defaultMarketingSettings}
                    save={(data, enabled) =>
                      run(async () => {
                        const saved = await action({
                          action: "save-resource",
                          kind: "FLOW",
                          key: resource.key,
                          name: resource.name,
                          data,
                          enabled,
                        });
                        setResource(saved);
                      }, "Flow saved; already queued messages keep their reviewed content.")
                    }
                  />
                </>
              )}
            </>
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
            <>
              {data.health && (
                <article className="mk-panel">
                  <h2>Delivery health</h2>
                  <p>
                    {data.health.unresolved} unresolved Shopify events. Sending
                    waits until they are processed.
                  </p>
                  {data.health.oldestPending && (
                    <p>
                      Oldest pending message:{" "}
                      {new Date(
                        data.health.oldestPending.dueAt,
                      ).toLocaleString()}{" "}
                      {data.health.oldestPending.error}
                    </p>
                  )}
                  {data.resources
                    .filter((r) => r.kind === "SYSTEM" && r.key === "worker")
                    .map((r) => (
                      <pre key={r.id}>{JSON.stringify(r.data, null, 2)}</pre>
                    ))}
                  {data.health.inbox.map((e) => (
                    <div className="mk-row" key={e.id}>
                      <strong>
                        {e.topic} · {e.status} · {e.attempts} attempts
                      </strong>
                      <p>{e.error}</p>
                      <button
                        disabled={busy || e.status === "PROCESSING"}
                        onClick={() =>
                          run(
                            () => action({ action: "retry-inbox", id: e.id }),
                            "Event queued for retry",
                          )
                        }
                      >
                        Retry after resolving the cause
                      </button>
                    </div>
                  ))}
                </article>
              )}
              <article className="mk-panel">
                <h2>Connection status</h2>
                {Object.entries(data.setup).map(([k, v]) => (
                  <p key={k}>
                    <strong>{k}</strong>:{" "}
                    {typeof v === "boolean"
                      ? v
                        ? "Ready"
                        : "Not enabled"
                      : String(v)}
                  </p>
                ))}
                <p>
                  Secrets stay in the deployment environment. The scheduled
                  worker runs every five minutes using the existing
                  scheduled-job hosting pattern.
                </p>
              </article>
              <article className="mk-panel">
                <h2>Shopify event connection</h2>
                <p>
                  Use this once to connect the customer, tag, checkout, and
                  order events that power the five workflows. This includes
                  Shopify customer tag events, which are not available in every
                  Shopify Admin webhook screen.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await action({
                        action: "register-shopify-webhooks",
                      });
                      setShopifyWebhookResult(r);
                    }, "Shopify event connection checked")
                  }
                >
                  Connect Shopify events
                </button>
                {shopifyWebhookResult !== null && (
                  <pre>{JSON.stringify(shopifyWebhookResult, null, 2)}</pre>
                )}
              </article>
              <article className="mk-panel">
                <h2>Operational controls</h2>
                <p>
                  Use these controls for normal day-to-day operation. They are
                  saved in Reef Ops and take effect without changing Railway.
                  Railway environment variables remain the deployment safety
                  gate; if a required gate is off there, the corresponding
                  control cannot send.
                </p>
                <label className="mk-check">
                  <input
                    type="checkbox"
                    checked={settingsForm.operations.sendingEnabled}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        operations: {
                          ...settingsForm.operations,
                          sendingEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Allow email and campaign sends
                </label>
                <label className="mk-check">
                  <input
                    type="checkbox"
                    checked={settingsForm.operations.migrationConfirmed}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        operations: {
                          ...settingsForm.operations,
                          migrationConfirmed: e.target.checked,
                        },
                      })
                    }
                  />
                  Confirm subscriber and suppression migration
                </label>
                <label className="mk-check">
                  <input
                    type="checkbox"
                    checked={settingsForm.operations.ingestEnabled}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        operations: {
                          ...settingsForm.operations,
                          ingestEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Process Shopify order and marketing events
                </label>
                <label className="mk-check">
                  <input
                    type="checkbox"
                    checked={settingsForm.operations.formEnabled}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        operations: {
                          ...settingsForm.operations,
                          formEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Enable the storefront signup form
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await action({
                        action: "save-settings",
                        settings: settingsForm,
                      });
                    }, "Operational controls saved")
                  }
                >
                  Save operational controls
                </button>
              </article>
              <article className="mk-panel">
                <h2>Email identity and compliance</h2>
                <p>
                  These values appear in every footer. The mailing address is
                  required for deliverability and CAN-SPAM compliance; changing
                  it here updates previews and future sends.
                </p>
                <label>
                  Organization name
                  <input
                    value={settingsForm.organizationName}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        organizationName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Business mailing address
                  <textarea
                    rows={3}
                    value={settingsForm.postalAddress}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        postalAddress: e.target.value,
                      })
                    }
                  />
                </label>
                <button
                  disabled={busy || !settingsForm.postalAddress.trim()}
                  onClick={() =>
                    run(async () => {
                      await action({
                        action: "save-settings",
                        settings: settingsForm,
                      });
                    }, "Email settings saved")
                  }
                >
                  Save email settings
                </button>
              </article>
              <article className="mk-panel">
                <h2>Migrate Klaviyo profiles</h2>
                <p>
                  Paste a normalized JSON batch of up to 500 profiles. Import
                  suppressions first, then subscribers and historical opens.
                  Preview validates and rolls back every row. Repeated imports
                  never clear suppressions or enroll old subscribers in welcome
                  flows.
                </p>
                <p>
                  Fields: email, phone, name, shopifyId, emailStatus, smsStatus,
                  emailSuppressed, smsSuppressed, consentAt, consentSource,
                  lastOpenedAt, lastOrderAt, lists, tags, timezone. Status
                  values: SUBSCRIBED, UNSUBSCRIBED, NEVER_SUBSCRIBED.
                </p>
                <textarea
                  aria-label="Import profiles JSON"
                  rows={12}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="mk-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () =>
                          setImportResult(
                            (
                              await action({
                                action: "import",
                                rows: JSON.parse(importText),
                                dryRun: true,
                              })
                            ).results,
                          ),
                        "Import preview complete",
                      )
                    }
                  >
                    Validate import
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () =>
                          setImportResult(
                            (
                              await action({
                                action: "import",
                                rows: JSON.parse(importText),
                                dryRun: false,
                              })
                            ).results,
                          ),
                        "Import batch processed; review each row",
                      )
                    }
                  >
                    Import batch
                  </button>
                </div>
                {importResult !== null && (
                  <pre>{JSON.stringify(importResult, null, 2)}</pre>
                )}
              </article>
            </>
          )}
        </>
      )}
    </section>
  );
}
function AudienceForm({
  busy,
  save,
}: {
  busy: boolean;
  save: (name: string, data: unknown) => void;
}) {
  const [name, setName] = useState(""),
    [tag, setTag] = useState(""),
    [list, setList] = useState(""),
    [days, setDays] = useState("365"),
    [exclude, setExclude] = useState("");
  return (
    <div>
      <h3>Create audience</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Opened email in previous days (optional)
        <input
          type="number"
          min="1"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </label>
      <label>
        Shopify tag (optional)
        <input value={tag} onChange={(e) => setTag(e.target.value)} />
      </label>
      <label>
        Static list (optional)
        <input value={list} onChange={(e) => setList(e.target.value)} />
      </label>
      <label>
        Exclude purchases in previous days (optional)
        <input
          type="number"
          min="1"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !name}
        onClick={() =>
          save(name, {
            ...(days ? { openedDays: Number(days) } : {}),
            ...(tag ? { tag } : {}),
            ...(list ? { list } : {}),
            ...(exclude ? { excludePurchasedDays: Number(exclude) } : {}),
          })
        }
      >
        Save audience
      </button>
    </div>
  );
}
