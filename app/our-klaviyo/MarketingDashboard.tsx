"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import EmailDesigner from "./EmailDesigner";
import { flowEmailTemplates } from "@/lib/marketing/flow-email-templates";
import FlowsWorkspace from "./FlowsWorkspace";
import "./flows.css";
import "./stock.css";
import AudienceWorkspace from "./AudienceWorkspace";
import SettingsWorkspace from "./SettingsWorkspace";
import AnalyticsWorkspace from "./AnalyticsWorkspace";
import "./settings.css";
import "./audiences.css";
import {
  Content,
  render,
  defaultCampaignContent,
  defaultMarketingSettings,
  MarketingSettings,
  withBranding,
} from "@/lib/marketing/rules";
import "./marketing.css";

type Resource = {
  id: string;
  key: string;
  kind: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
  subject?: string;
  sourceFlow?: string;
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
  createdAt?: string;
  content: Content;
  audience: Record<string, unknown>;
  smartSendingHours: number;
  recipientMode: string;
  _count: { messages: number };
};
type CampaignAudience = {
  version: 2;
  includeKeys: string[];
  excludeKeys: string[];
};
type CampaignForm = {
  id?: string;
  name: string;
  subject: string;
  content: Content;
  audience: CampaignAudience;
  smartSending: boolean;
  recipientMode: "SEND_TIME" | "SCHEDULE_TIME";
};
type CampaignReport = {
  campaign: { id: string; name: string; status: string; scheduledAt: string | null };
  totals: {
    messages: number;
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    ordered: number;
    skipped: number;
    failed: number;
    needsAttention: number;
    revenue: Record<string, number>;
  };
  reasons: { reason: string; count: number }[];
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
const flowTemplateGroups = [
  {
    key: "welcome",
    name: "Welcome Series",
    description: "Emails sent after a visitor joins the mailing list.",
  },
  {
    key: "b2b-welcome",
    name: "B2B Welcome",
    description: "The wholesale introduction for staff-tagged B2B contacts.",
  },
  {
    key: "delivery-upsell",
    name: "24-hour Add-on Notice",
    description: "The delivery-date reminder for adding to an existing order.",
  },
  {
    key: "abandoned-cart",
    name: "Abandoned Cart",
    description: "Cart recovery emails, including the two purchase-history outcomes.",
  },
] as const;
const newCampaign = () => ({
  name: "",
  subject: "",
  content: structuredClone(defaultCampaignContent),
  audience: { version: 2 as const, includeKeys: ["mailable"], excludeKeys: [] },
  smartSending: true,
  recipientMode: "SEND_TIME" as const,
});
const sameRules = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const currentCampaignContent = (item: Campaign) => {
  const saved = structuredClone(item.content);
  const sections = saved.campaignLayout?.sections;
  if (item.status !== "DRAFT" || !sections || sections.length !== 4) return saved;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const saleProducts =
    byId.get("sale-products") || byId.get("anniversary-sale-products");
  if (
    !saleProducts ||
    !byId.has("new-discount-products") ||
    !byId.has("newest-products") ||
    !byId.has("shop-cta")
  ) return saved;
  const currentDefaults = defaultCampaignContent.campaignLayout!.sections;
  saved.campaignLayout!.sections = [
    { ...saleProducts, id: "sale-products" },
    byId.get("new-discount-products")!,
    byId.get("shop-cta")!,
    byId.get("newest-products")!,
    ...currentDefaults
      .filter((section) => section.type === "banner")
      .map((section) => structuredClone(section)),
  ];
  return saved;
};
const campaignForm = (item: Campaign, resources: Resource[]): CampaignForm => {
  const saved = item.audience as Partial<CampaignAudience>;
  const audience =
    saved.version === 2
      ? {
          version: 2 as const,
          includeKeys: Array.isArray(saved.includeKeys) ? saved.includeKeys : [],
          excludeKeys: Array.isArray(saved.excludeKeys) ? saved.excludeKeys : [],
        }
      : {
          version: 2 as const,
          includeKeys: resources
            .filter((resource) => resource.kind === "SEGMENT" && sameRules(resource.data, item.audience))
            .map((resource) => resource.key)
            .slice(0, 1),
          excludeKeys: [],
        };
  return {
    id: item.id,
    name: item.name,
    subject: item.subject,
    content: currentCampaignContent(item),
    audience,
    smartSending: item.smartSendingHours > 0,
    recipientMode:
      item.recipientMode === "SCHEDULE_TIME" ? "SCHEDULE_TIME" : "SEND_TIME",
  };
};
export default function MarketingDashboard({ tab }: { tab: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);

  const [campaign, setCampaign] = useState<CampaignForm>(newCampaign());
  const [at, setAt] = useState(""),
    [editingEmail, setEditingEmail] = useState(false),
    [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignStep, setCampaignStep] = useState(0);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignReport, setCampaignReport] = useState<CampaignReport | null>(null);
  const [dismissalDraft, setDismissalDraft] = useState<boolean | null>(null);
  const [popupDelayDraft, setPopupDelayDraft] = useState<string | null>(null);
  const [resource, setResource] = useState<Resource | null>(null);
  const [previewingCampaign, setPreviewingCampaign] = useState<Campaign | null>(null);
  const templates: Resource[] = data
    ? [
        ...flowEmailTemplates(data.resources),
        ...data.resources.filter((r) => r.kind === "TEMPLATE"),
      ]
    : [];
  const reusableTemplates = templates.filter((template) => !template.sourceFlow);
  const campaignAudiences = (data?.resources || []).filter(
    (item) => item.kind === "SEGMENT",
  );
  const campaignLists = campaignAudiences.filter((item) =>
    item.key.startsWith("klaviyo-list-"),
  );
  const campaignSegments = campaignAudiences.filter(
    (item) => !item.key.startsWith("klaviyo-list-"),
  );
  const toggleAudience = (
    field: "includeKeys" | "excludeKeys",
    key: string,
  ) => {
    setCampaign((current) => {
      const selected = current.audience[field];
      const next = selected.includes(key)
        ? selected.filter((item) => item !== key)
        : [...selected, key];
      const other = field === "includeKeys" ? "excludeKeys" : "includeKeys";
      return {
        ...current,
        audience: {
          ...current.audience,
          [field]: next,
          [other]: current.audience[other].filter((item) => item !== key),
        },
      };
    });
    setAudienceCount(null);
  };
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
  const editingContent = withBranding(
    previewingCampaign
      ? previewingCampaign.content
      : resource
        ? (resource.data as unknown as Content)
        : campaign.content,
    data?.settings.branding,
  );
  let emailHtml = "",
    emailPreviewError = "";
  if (editingEmail || resource || previewingCampaign) {
    try {
      emailHtml = render(
        editingContent,
        "#unsubscribe",
        data?.settings.postalAddress || "",
        undefined,
        data?.settings.organizationName,
        data?.settings.branding,
      );
    } catch (e) {
      emailPreviewError =
        e instanceof Error ? e.message : "Check the email content.";
    }
  }
  const savedPopupPause = data?.settings.popupDismissalDays !== 0;
  const popupPause = dismissalDraft ?? savedPopupPause;
  const savedPopupDelay = data?.settings.popupDelaySeconds ?? 10;
  const popupDelayValue = popupDelayDraft ?? String(savedPopupDelay);
  const popupDelaySeconds = Number(popupDelayValue);
  const popupDelayValid =
    Number.isInteger(popupDelaySeconds) &&
    popupDelaySeconds >= 0 &&
    popupDelaySeconds <= 300;
  return (
    <section className="marketing">
      {(editingEmail || resource || previewingCampaign) && (
        <EmailDesigner
          title={previewingCampaign?.name || (resource ? resource.name : campaign.name || "Campaign email")}
          backLabel={previewingCampaign ? "Back to campaigns" : resource ? "Back to templates" : "Back to campaign"}
          readOnly={!!previewingCampaign}
          editProducts
          subjectEditable={!resource}
          subject={previewingCampaign?.subject || (resource ? resource.subject || "Template preview" : campaign.subject)}
          content={editingContent}
          html={emailHtml}
          previewError={emailPreviewError}
          busy={busy}
          status={
            error ||
            notice ||
            (resource?.sourceFlow
              ? "Save creates a separate template; the flow email stays unchanged."
              : "Save email to keep your changes.")
          }
          organizationName={
            data?.settings.organizationName || "Corals Anonymous"
          }
          postalAddress={data?.settings.postalAddress || ""}
          onSubject={(subject) => {
            if (!resource) setCampaign((c) => ({ ...c, subject }));
          }}
          onContent={(key, value) =>
            resource
              ? setResource((r) =>
                  r ? { ...r, data: { ...r.data, [key]: value } } : r,
                )
              : update(key, value)
          }
          onClose={() => {
            setEditingEmail(false);
            setResource(null);
            setPreviewingCampaign(null);
          }}
          onSave={async () =>
            !!(await run(async () => {
              if (resource?.sourceFlow) {
                const copy = await action({
                  action: "save-resource",
                  kind: "TEMPLATE",
                  name: `${resource.name} copy`,
                  data: resource.data,
                });
                setResource({
                  ...resource,
                  id: copy.id,
                  key: copy.key,
                  name: copy.name,
                  sourceFlow: undefined,
                });
              } else if (resource)
                await action({ action: "save-resource", ...resource });
              else await save();
              return true;
            }, "Email saved"))
          }
          onTest={async (to, subject, content) => {
            await action({ action: "test-email", to, subject, content });
          }}
        />
      )}
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
          {tab === "overview" && (
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
          {tab === "analytics" && <AnalyticsWorkspace />}
          {tab === "campaigns" && (
            <div className={`mk-campaign-workspace ${campaignOpen ? "is-editing" : "is-browsing"}`}>
              <div className="mk-campaign-intro">
                <div>
                  <p className="mk-eyebrow">ONE-TIME EMAIL CAMPAIGNS</p>
                  <h2>{campaignOpen ? campaign.name || "New campaign" : "Your campaigns"}</h2>
                  <p>
                    {campaignOpen ? "Choose your audience, design your email, then review the send time." : "Manage sale emails, new arrivals, and announcements in one place."}
                  </p>
                </div>
                {campaignOpen ? <button onClick={() => setCampaignOpen(false)}>Back to campaigns</button> : (
                  <button
                    onClick={() => {
                      setCampaign(newCampaign());
                      setAt("");
                      setAudienceCount(null);
                      setCampaignOpen(true);
                      setCampaignStep(0);
                    }}
                  >
                    Create campaign
                  </button>
                )}
              </div>
              <div className="mk-campaign-layout">
                {campaignOpen && <article className="mk-panel mk-campaign-composer">
                  <nav className="mk-campaign-steps" aria-label="Campaign setup">
                    {["Audience", "Email", "Review & schedule"].map((label, index) => (
                      <button key={label} aria-current={campaignStep === index ? "step" : undefined} onClick={() => setCampaignStep(index)}>{index + 1}. {label}</button>
                    ))}
                  </nav>
                  <div className="mk-campaign-composer-heading">
                    <div>
                      <p className="mk-eyebrow">CAMPAIGN DRAFT</p>
                      <h2>
                        {campaign.id ? "Edit campaign draft" : "Create campaign"}
                      </h2>
                    </div>
                    <span className="mk-status">
                      {campaign.id ? "Saved draft" : "New draft"}
                    </span>
                  </div>
                  <section className="mk-campaign-section" hidden={campaignStep !== 0}>
                    <div className="mk-campaign-section-heading">
                      <span>1</span>
                      <div>
                        <h3>Campaign details</h3>
                        <p>Give the campaign an internal name and choose who receives it.</p>
                      </div>
                    </div>
                    <label>
                      Campaign name
                      <input
                        placeholder="Example: September coral sale"
                        value={campaign.name}
                        onChange={(e) =>
                          setCampaign({ ...campaign, name: e.target.value })
                        }
                      />
                    </label>
                    <div className="mk-audience-builder">
                      <div className="mk-audience-builder-heading">
                        <div>
                          <strong>Send to</strong>
                          <span>Recipients who belong to any selected group are included.</span>
                        </div>
                        <span className="mk-status">
                          {campaign.audience.includeKeys.length || "All"} selected
                        </span>
                      </div>
                      {!campaign.audience.includeKeys.length && (
                        <p className="mk-audience-warning">
                          All eligible email subscribers are selected. Choose a segment for a more focused campaign.
                        </p>
                      )}
                      <div className="mk-audience-kind">
                        <div>
                          <strong>Dynamic segments</strong>
                          <span>Rule-based groups that update as customer activity changes.</span>
                        </div>
                        <div className="mk-audience-options">
                          {campaignSegments.map((item) => (
                            <label key={item.id}>
                              <input
                                type="checkbox"
                                checked={campaign.audience.includeKeys.includes(item.key)}
                                onChange={() => toggleAudience("includeKeys", item.key)}
                              />
                              <span>{item.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="mk-audience-kind">
                        <div>
                          <strong>Lists</strong>
                          <span>Explicit profile memberships imported from Klaviyo.</span>
                        </div>
                        <div className="mk-audience-options">
                          {campaignLists.map((item) => (
                            <label key={item.id}>
                              <input
                                type="checkbox"
                                checked={campaign.audience.includeKeys.includes(item.key)}
                                onChange={() => toggleAudience("includeKeys", item.key)}
                              />
                              <span>{item.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <details className="mk-audience-exclusions">
                        <summary>Don’t send to ({campaign.audience.excludeKeys.length})</summary>
                        <p>Anyone in any selected exclusion group is removed from this send.</p>
                        <div className="mk-audience-options">
                          {campaignAudiences.map((item) => (
                            <label key={item.id}>
                              <input
                                type="checkbox"
                                checked={campaign.audience.excludeKeys.includes(item.key)}
                                onChange={() => toggleAudience("excludeKeys", item.key)}
                              />
                              <span>
                                {item.name}
                                <small>{item.key.startsWith("klaviyo-list-") ? "List" : "Segment"}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </details>
                    </div>
                    <div className="mk-campaign-audience-check">
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
                          <b>{audienceCount.toLocaleString()}</b> currently eligible.
                          Send-time consent and suppression checks still apply.
                        </p>
                      )}
                    </div>
                  </section>
                  <section className="mk-campaign-section" hidden={campaignStep !== 1}>
                    <div className="mk-campaign-section-heading">
                      <span>2</span>
                      <div>
                        <h3>Email content</h3>
                        <p>Start with a proven layout, then tailor the message for this sale.</p>
                      </div>
                    </div>
                    <label>
                      Subject line
                      <input
                        placeholder="Example: 20% off new arrivals this weekend"
                        value={campaign.subject}
                        onChange={(e) =>
                          setCampaign({ ...campaign, subject: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Start from a template
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const template = templates.find(
                            (r) => r.id === e.target.value,
                          );
                          if (template)
                            setCampaign({
                              ...campaign,
                              ...(template.subject ? { subject: template.subject } : {}),
                              content: template.data as unknown as Content,
                            });
                        }}
                      >
                        <option value="">Choose a template</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.sourceFlow
                              ? `${template.name} · ${flowTemplateGroups.find((group) => group.key === template.sourceFlow)?.name || "Flow"}`
                              : template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mk-campaign-email-action">
                      <div>
                        <strong>{campaign.subject || "Your campaign email"}</strong>
                        <span>Open the editor to update content, artwork, buttons, products, and preview.</span>
                      </div>
                      <button onClick={() => setEditingEmail(true)}>
                        Edit email and preview
                      </button>
                    </div>
                    <div className="mk-actions">
                      <button disabled={busy} onClick={() => run(save, "Draft saved")}>
                        Save draft
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
                  </section>
                  <section className="mk-campaign-section" hidden={campaignStep !== 2}>
                    <div className="mk-campaign-review">
                      <strong>{campaign.name || "Campaign name needed"}</strong>
                      <p>Subject: {campaign.subject || "Subject line needed"}</p>
                      <p>{audienceCount === null ? "Audience count has not been checked." : `${audienceCount.toLocaleString()} currently eligible recipients.`}</p>
                      <button onClick={() => setEditingEmail(true)}>Review email</button>
                    </div>
                    <div className="mk-campaign-section-heading">
                      <span>3</span>
                      <div>
                        <h3>Schedule</h3>
                        <p>Scheduling never bypasses your sending and audience safeguards.</p>
                      </div>
                    </div>
                    <div className="mk-delivery-options">
                      <fieldset>
                        <legend>Recipient timing</legend>
                        <label>
                          <input
                            type="radio"
                            name="recipientMode"
                            checked={campaign.recipientMode === "SEND_TIME"}
                            onChange={() => setCampaign({ ...campaign, recipientMode: "SEND_TIME" })}
                          />
                          <span>
                            <strong>Determine recipients at send time</strong>
                            <small>The segment is recalculated when delivery begins. Best for dynamic campaign segments.</small>
                          </span>
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="recipientMode"
                            checked={campaign.recipientMode === "SCHEDULE_TIME"}
                            onChange={() => setCampaign({ ...campaign, recipientMode: "SCHEDULE_TIME" })}
                          />
                          <span>
                            <strong>Freeze recipients when scheduled</strong>
                            <small>Keeps the current audience snapshot even if segment membership changes later.</small>
                          </span>
                        </label>
                      </fieldset>
                      <label className="mk-smart-sending">
                        <input
                          type="checkbox"
                          checked={campaign.smartSending}
                          onChange={(event) => setCampaign({ ...campaign, smartSending: event.target.checked })}
                        />
                        <span>
                          <strong>16-hour Smart Sending</strong>
                          <small>Skip recipients who received another marketing email in the previous 16 hours.</small>
                        </span>
                      </label>
                    </div>
                    <label>
                      Send time (your device’s local timezone)
                      <input
                        type="datetime-local"
                        value={at}
                        onChange={(e) => setAt(e.target.value)}
                      />
                    </label>
                    <div className="mk-schedule-actions">
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
                            setCampaign(newCampaign());
                            setAt("");
                            setAudienceCount(null);
                            setCampaignOpen(false);
                          }, "Campaign scheduled. Sending requires completed setup and an active worker.")
                        }
                      >
                        Save and schedule
                      </button>
                      <button
                        className="mk-campaign-primary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const id = await save();
                            await action({ action: "send-now", id });
                            setCampaign(newCampaign());
                            setAt("");
                            setAudienceCount(null);
                            setCampaignOpen(false);
                          }, "Campaign queued to send now. Delivery begins on the next worker run.")
                        }
                      >
                        Send now
                      </button>
                    </div>
                  </section>
                  <div className="mk-campaign-navigation">
                    <button disabled={campaignStep === 0} onClick={() => setCampaignStep((step) => step - 1)}>Back</button>
                    {campaignStep < 2 && <button className="mk-campaign-primary" onClick={() => setCampaignStep((step) => step + 1)}>Continue to {campaignStep === 0 ? "email" : "review"} →</button>}
                  </div>
                </article>}
                {!campaignOpen && <aside className="mk-campaign-library">
                  <div className="mk-campaign-library-heading">
                    <div>
                      <p className="mk-eyebrow">CAMPAIGN LIBRARY</p>
                      <h2>Your campaigns</h2>
                    </div>
                    <span className="mk-status">{data.campaigns.length}</span>
                  </div>
                  {campaignReport && (
                    <section className="mk-campaign-report" aria-label={`${campaignReport.campaign.name} results`}>
                      <div className="mk-campaign-report-heading">
                        <div>
                          <p className="mk-eyebrow">CAMPAIGN RESULTS</p>
                          <h3>{campaignReport.campaign.name}</h3>
                        </div>
                        <button onClick={() => setCampaignReport(null)}>Close</button>
                      </div>
                      <div className="mk-campaign-report-grid">
                        {[
                          ["Sent", campaignReport.totals.sent],
                          ["Delivered", campaignReport.totals.delivered],
                          ["Opened", campaignReport.totals.opened],
                          ["Clicked", campaignReport.totals.clicked],
                          ["Ordered", campaignReport.totals.ordered],
                          ["Skipped", campaignReport.totals.skipped],
                          ["Failed", campaignReport.totals.failed],
                          ["Needs review", campaignReport.totals.needsAttention],
                        ].map(([label, value]) => (
                          <div key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>
                        ))}
                      </div>
                      {!!Object.keys(campaignReport.totals.revenue).length && (
                        <p className="mk-campaign-revenue">
                          Attributed revenue: {Object.entries(campaignReport.totals.revenue).map(([currency, amount]) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ")}
                        </p>
                      )}
                      {!!campaignReport.reasons.length && (
                        <details>
                          <summary>Why messages were skipped or need attention</summary>
                          <ul>{campaignReport.reasons.map((item) => <li key={item.reason}><span>{item.reason}</span><b>{item.count}</b></li>)}</ul>
                        </details>
                      )}
                    </section>
                  )}
                  {!!data.campaigns.length && <label>Search campaigns<input type="search" placeholder="Search by campaign name or subject" value={campaignSearch} onChange={(event) => setCampaignSearch(event.target.value)} /></label>}
                  {!data.campaigns.length ? (
                    <div className="mk-campaign-empty">
                      <strong>No campaigns yet</strong>
                      <span>Create an email, choose your audience, and schedule your first campaign.</span>
                      <button className="mk-campaign-primary" onClick={() => { setCampaign(newCampaign()); setAt(""); setAudienceCount(null); setCampaignStep(0); setCampaignOpen(true); }}>Create your first campaign</button>
                    </div>
                  ) : (
                    <div className="mk-campaign-list">
                      {data.campaigns.filter((item) => `${item.name} ${item.subject}`.toLowerCase().includes(campaignSearch.toLowerCase())).map((item) => {
                        const statusCounts = data.messageCounts.filter(
                          (count) => count.campaignId === item.id,
                        );
                        const sent = statusCounts
                          .filter((count) => count.status === "SENT")
                          .reduce((total, count) => total + count._count, 0);
                        const pending = statusCounts
                          .filter((count) => count.status === "PENDING")
                          .reduce((total, count) => total + count._count, 0);
                        return (
                          <article className="mk-campaign-card" key={item.id}>
                            <div className="mk-campaign-card-heading">
                              <span className={`mk-campaign-status mk-campaign-status-${item.status.toLowerCase()}`}>
                                {item.status.toLowerCase()}
                              </span>
                              {item.scheduledAt && (
                                <time dateTime={item.scheduledAt}>
                                  {new Date(item.scheduledAt).toLocaleString()}
                                </time>
                              )}
                            </div>
                            <h3>{item.name}</h3>
                            <p>{item.subject}</p>
                            <div className="mk-campaign-card-metrics">
                              <span>{item._count.messages} messages</span>
                              {sent > 0 && <span>{sent} sent</span>}
                              {pending > 0 && <span>{pending} pending</span>}
                            </div>
                            <div className="mk-actions">
                              {item.status === "DRAFT" && (
                                <button
                                  onClick={() => {
                                    setCampaign(campaignForm(item, data.resources));
                                    setCampaignOpen(true);
                                    setCampaignStep(0);
                                    setAt("");
                                    setAudienceCount(null);
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                              <button
                                onClick={() => setPreviewingCampaign(item)}
                              >
                                View email
                              </button>
                              <button
                                onClick={() => {
                                  setCampaignOpen(true);
                                  setCampaignStep(0);
                                  setCampaign({
                                    name: `${item.name} copy`,
                                    subject: item.subject,
                                    content: item.content,
                                    audience: campaignForm(item, data.resources).audience,
                                    smartSending: item.smartSendingHours > 0,
                                    recipientMode: item.recipientMode === "SCHEDULE_TIME" ? "SCHEDULE_TIME" : "SEND_TIME",
                                  });
                                  setAt("");
                                  setAudienceCount(null);
                                }}
                              >
                                Duplicate
                              </button>
                              {item._count.messages > 0 && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      const response = await fetch(`/api/marketing?view=campaign-report&id=${encodeURIComponent(item.id)}`, { cache: "no-store" });
                                      const report = await response.json();
                                      if (!response.ok) throw new Error(report.error);
                                      setCampaignReport(report);
                                    }, "Campaign results loaded")
                                  }
                                >
                                  View results
                                </button>
                              )}
                              {["DRAFT", "SCHEDULED", "SENDING"].includes(item.status) && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(
                                      () => action({ action: "cancel", id: item.id }),
                                      "Campaign cancelled. Messages already in flight may finish.",
                                    )
                                  }
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </aside>}
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
            <div className="mk-template-library">
              <p className="mk-muted">
                Flow emails stay linked to their saved flows. Choose one to preview the
                exact email, or save a separate reusable copy.
              </p>
              {flowTemplateGroups.map((group) => {
                const groupTemplates = templates.filter(
                  (template) => template.sourceFlow === group.key,
                );
                if (!groupTemplates.length) return null;
                return (
                  <section className="mk-template-group" key={group.key}>
                    <div className="mk-template-group-heading">
                      <div>
                        <p className="mk-eyebrow">FLOW EMAILS</p>
                        <h2>{group.name}</h2>
                        <p>{group.description}</p>
                      </div>
                      <span className="mk-status">
                        {groupTemplates.length} email{groupTemplates.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mk-template-grid">
                      {groupTemplates.map((template) => (
                        <article className="mk-template-card" key={template.id}>
                          <div className="mk-template-card-topline">
                            <span>{template.name}</span>
                            <span className="mk-status">From flow</span>
                          </div>
                          <p className="mk-template-label">Subject line</p>
                          <h3>{template.subject}</h3>
                          <button onClick={() => setResource(template)}>
                            Preview and make a copy
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
              <section className="mk-template-group">
                <div className="mk-template-group-heading">
                  <div>
                    <p className="mk-eyebrow">STANDALONE TEMPLATES</p>
                    <h2>Reusable templates</h2>
                    <p>Saved layouts that are not tied to a specific flow.</p>
                  </div>
                  <span className="mk-status">
                    {reusableTemplates.length} template{reusableTemplates.length === 1 ? "" : "s"}
                  </span>
                </div>
                {reusableTemplates.length ? (
                  <div className="mk-template-grid">
                    {reusableTemplates.map((template) => (
                      <article className="mk-template-card" key={template.id}>
                        <div className="mk-template-card-topline">
                          <span>{template.name}</span>
                          <span className="mk-status">Reusable</span>
                        </div>
                        <p className="mk-template-label">Template layout</p>
                        <h3>{template.subject || "Corals Anonymous email layout"}</h3>
                        <button onClick={() => setResource(template)}>Review and edit</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mk-template-empty">
                    No standalone templates yet. Save a copy from a flow email to start one.
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "forms" && (
            <article className="mk-panel">
              <h2>Storefront email signup</h2>
              <p>
                Control when the storefront popup appears on desktop and mobile.
                Submitted visitors and recognized profiles are suppressed.
              </p>
              <p>
                The updated welcome flow uses single opt-in: agreeing to email
                marketing starts the series without a confirmation email. SMS
                signup is not part of this sequence. Save and review the welcome
                flow before replacing the existing Klaviyo popup.
              </p>
              <p>
                Form enabled: <b>{data.setup.formEnabled ? "Yes" : "No"}</b> ·
                Discounts: <b>Managed in the welcome flow</b>
              </p>
              <div className="mk-form-setting">
                <label>
                  Time before popup appears (seconds)
                  <input
                    type="number"
                    min="0"
                    max="300"
                    step="1"
                    value={popupDelayValue}
                    onChange={(event) => setPopupDelayDraft(event.target.value)}
                  />
                </label>
                <p>
                  Enter 0 to show it immediately, or up to 300 seconds. The
                  current setting is {savedPopupDelay} seconds.
                </p>
                <label className="mk-check">
                  <input
                    type="checkbox"
                    checked={popupPause}
                    onChange={(event) =>
                      setDismissalDraft(event.target.checked)
                    }
                  />
                  Pause for 7 days after a visitor closes the popup
                </label>
                <p>
                  {popupPause
                    ? "A visitor who closes the popup will not see it again in this browser for seven days."
                    : "Closing the popup hides it only for the current page. It can appear again after the visitor loads another page."}
                </p>
                <button
                  disabled={
                    busy ||
                    !popupDelayValid ||
                    (popupPause === savedPopupPause &&
                      popupDelaySeconds === savedPopupDelay)
                  }
                  onClick={() =>
                    void run(
                      () =>
                        action({
                          action: "save-settings",
                          settings: {
                            popupDismissalDays: popupPause ? 7 : 0,
                            popupDelaySeconds,
                          },
                        }),
                      "Popup display setting saved.",
                    )
                  }
                >
                  {busy ? "Saving…" : "Save popup setting"}
                </button>
              </div>
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
