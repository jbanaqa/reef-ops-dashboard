"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FlowEditor from "./FlowEditor";
import LowStockEditor from "./LowStockEditor";
import { flowSequence, type FlowConfig } from "@/lib/marketing/flow-config";
import type { Content, MarketingSettings } from "@/lib/marketing/rules";
export type FlowResource = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
};
type MessageCount = { flowKey: string | null; status: string; _count: number };
const descriptions: Record<
  string,
  { trigger: string; description: string; symbol: string }
> = {
  "b2b-welcome": {
    trigger: "B2B tag added",
    description:
      "Welcome a wholesale customer once when their B2B tag is added.",
    symbol: "B2B",
  },
  welcome: {
    trigger: "Email signup confirmed",
    description:
      "Introduce new subscribers to your store and first-order offer.",
    symbol: "Hi",
  },
  "abandoned-cart": {
    trigger: "Checkout started",
    description:
      "Follow up on unfinished checkouts, with purchase checks before sending.",
    symbol: "↗",
  },
  "delivery-upsell": {
    trigger: "Delivery scheduled",
    description:
      "Reach customers before an expected delivery with a relevant offer.",
    symbol: "◷",
  },
  "low-stock": {
    trigger: "Stock falls below threshold",
    description: "Notify your internal team when an item needs attention.",
    symbol: "↓",
  },
};
export function flowSummary(resource: FlowResource) {
  try {
    const steps = flowSequence(
      resource.key,
      resource.data as unknown as FlowConfig,
    );
    const channels = [
      ...new Set(
        steps.map((s) =>
          s.channel === "EMAIL"
            ? "Email"
            : s.channel === "SMS_MARKETING" || s.channel === "SMS_TRANSACTIONAL"
              ? "Text"
              : "Other",
        ),
      ),
    ];
    return {
      count: steps.length,
      channels: channels.sort().join(" + ") || "Not configured",
    };
  } catch {
    return { count: null, channels: "Review configuration" };
  }
}
export function flowStatus(resource: FlowResource) {
  return resource.data.reviewed !== true
    ? "review"
    : resource.enabled
      ? "enabled"
      : "paused";
}
const statusLabels: Record<string, string> = {
  enabled: "Enabled",
  paused: "Paused",
  review: "Needs review",
};
export default function FlowsWorkspace({
  resources,
  messageCounts,
  setup,
  unresolved,
  settings,
  busy,
  refresh,
  save,
  testEmail,
}: {
  resources: FlowResource[];
  messageCounts: MessageCount[];
  setup: Record<string, unknown>;
  unresolved?: number;
  settings: MarketingSettings;
  busy: boolean;
  refresh: () => Promise<unknown>;
  save: (
    resource: FlowResource,
    data: Record<string, unknown>,
    enabled: boolean,
  ) => Promise<FlowResource | undefined>;
  testEmail: (
    to: string,
    subject: string,
    content: Content,
  ) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("enabled");
  const [selected, setSelected] = useState<FlowResource | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<{ id: string; scroll: number } | null>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId) {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start" });
    } else if (returnTo.current) {
      document
        .getElementById("flow-open-" + returnTo.current.id)
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: returnTo.current.scroll });
    }
  }, [selectedId]);
  const flows = useMemo(
    () =>
      resources.map((resource) => ({
        resource,
        summary: flowSummary(resource),
        status: flowStatus(resource),
        meta: descriptions[resource.key] || {
          trigger: "Customer event",
          description:
            "Review this workflow’s steps and settings before enabling it.",
          symbol: "→",
        },
      })),
    [resources],
  );
  const enabled = flows.filter((f) => f.status === "enabled").length;
  const needsReview = flows.filter((f) => f.status === "review").length;
  const visible = flows
    .filter(
      (f) =>
        (filter === "all" || f.status === filter) &&
        (f.resource.name + " " + f.meta.trigger + " " + f.meta.description)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "enabled"
        ? Number(b.status === "enabled") - Number(a.status === "enabled") ||
          a.resource.name.localeCompare(b.resource.name)
        : a.resource.name.localeCompare(b.resource.name),
    );
  const status = selected ? flowStatus(selected) : null;
  const waitingForSetup = !setup.emailReady || !setup.migrationConfirmed;
  return (
    <div className="fw-workspace">
      {selected ? (
        <>
          <div className="fw-detail-header">
            <button disabled={busy} onClick={() => setSelected(null)}>
              ← All flows
            </button>
            <div>
              <p className="fw-eyebrow">WORKFLOW</p>
              <h2 ref={heading} tabIndex={-1}>
                {selected.name}
              </h2>
              <p>
                {descriptions[selected.key]?.description ||
                  "Review this workflow’s steps and settings."}
              </p>
            </div>
            <span className={"fw-badge " + status}>
              {statusLabels[status!]}
            </span>
          </div>
          {selected.key === "low-stock" ? (
            <LowStockEditor
              key={selected.id}
              resource={selected}
              busy={busy}
              setup={setup}
              settings={settings}
              save={async (data, enabled) => {
                const result = await save(selected, data, enabled);
                if (result) setSelected(result);
                return result;
              }}
            />
          ) : (
            <FlowEditor
              key={selected.id}
              resource={selected}
              busy={busy}
              settings={settings}
              testEmail={testEmail}
              save={async (data, enabled) => {
                const result = await save(
                  selected,
                  data as unknown as Record<string, unknown>,
                  enabled,
                );
                if (result) setSelected(result);
                return result;
              }}
            />
          )}
        </>
      ) : (
        <>
          <div className="fw-intro">
            <div>
              <p className="fw-eyebrow">CUSTOMER JOURNEYS</p>
              <h2>The right message, at the right moment</h2>
              <p>
                Manage the workflows that welcome customers, follow up, and keep
                your team informed.
              </p>
            </div>
            <button disabled={busy} onClick={() => void refresh()}>
              {busy ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
          <div className="fw-stats" aria-label="Flow overview">
            <div>
              <strong>{flows.length}</strong>
              <span>Total workflows</span>
            </div>
            <div>
              <strong>{enabled}</strong>
              <span>Enabled</span>
            </div>
            <div>
              <strong>{needsReview}</strong>
              <span>Need review</span>
            </div>
          </div>
          <div className="fw-sending-note">
            <span className="fw-note-dot" aria-hidden="true" />
            <div>
              <strong>
                {!setup.sendingEnabled
                  ? "Customer sending is paused"
                  : waitingForSetup
                    ? "Sending setup needs attention"
                    : unresolved
                      ? "Sending is waiting for Shopify updates"
                      : "Customer sending is enabled"}
              </strong>
              <p>
                {!setup.sendingEnabled
                  ? "Enabled flows can schedule messages while sending is off. Your email previews are still available."
                  : waitingForSetup
                    ? "Review email configuration and subscriber history in Settings before delivery can run."
                    : unresolved
                      ? "Process the outstanding Shopify events in Settings. Workflow and subscription checks still apply."
                      : "Each message still needs to pass its workflow, timing, and subscription checks."}
              </p>
            </div>
            <Link href="/our-klaviyo/settings">Sending settings →</Link>
          </div>
          <section className="fw-directory" aria-label="Workflows">
            <div className="fw-toolbar">
              <label className="fw-search">
                Find a workflow
                <input
                  type="search"
                  placeholder="Search by name or trigger"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                Status
                <select
                  aria-label="Status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="enabled">Enabled</option>
                  <option value="paused">Paused</option>
                  <option value="review">Needs review</option>
                </select>
              </label>
              <label>
                Sort by
                <select
                  aria-label="Sort by"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="enabled">Enabled first</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>
            <div className="fw-list-caption">
              <span role="status">
                {visible.length} of {flows.length} workflows
              </span>
              <span>Message counts are all-time</span>
            </div>
            <div className="fw-list">
              {visible.map(({ resource: r, meta, summary, status }) => {
                const activity = messageCounts.filter(
                  (m) => m.flowKey === r.key,
                );
                const count = (...statuses: string[]) =>
                  activity
                    .filter((m) => statuses.includes(m.status))
                    .reduce((n, m) => n + m._count, 0);
                const attention = count("FAILED", "UNKNOWN");
                return (
                  <article className="fw-row" key={r.id}>
                    <div className="fw-flow-icon" aria-hidden="true">
                      {meta.symbol}
                    </div>
                    <div className="fw-flow-info">
                      <div className="fw-name-line">
                        <h3>{r.name}</h3>
                        <span className={"fw-badge " + status}>
                          {statusLabels[status]}
                        </span>
                      </div>
                      <p>{meta.description}</p>
                      <div className="fw-meta">
                        <span>Starts: {meta.trigger}</span>
                        <span>{summary.channels}</span>
                        <span>
                          {summary.count === null
                            ? "Review steps"
                            : summary.count +
                              (summary.count === 1
                                ? " message step"
                                : " message steps")}
                        </span>
                        {r.key === "low-stock" && <span>Internal team</span>}
                      </div>
                      {attention > 0 && (
                        <p className="fw-attention">
                          {attention}{" "}
                          {attention === 1 ? "message needs" : "messages need"}{" "}
                          attention. Check the recipient’s message history.
                        </p>
                      )}
                    </div>
                    <dl className="fw-activity">
                      <div>
                        <dt>Queued / sending</dt>
                        <dd>{count("PENDING", "SENDING").toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Sent</dt>
                        <dd>{count("SENT").toLocaleString()}</dd>
                      </div>
                    </dl>
                    <button
                      id={"flow-open-" + r.id}
                      className="fw-open"
                      aria-label={"Open " + r.name}
                      onClick={() => {
                        returnTo.current = { id: r.id, scroll: window.scrollY };
                        setSelected(r);
                      }}
                    >
                      Open flow <span aria-hidden="true">→</span>
                    </button>
                  </article>
                );
              })}
            </div>
            {!visible.length && (
              <div className="fw-empty">
                <span aria-hidden="true">⌕</span>
                <h3>
                  {flows.length ? "No workflows match" : "No workflows yet"}
                </h3>
                <p>
                  {flows.length
                    ? "Try a different name or status to find your workflow."
                    : "Create the default workflows using the setup button above."}
                </p>
                {flows.length > 0 && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </section>
          <div className="fw-bottom-note">
            <p>
              <strong>Needs review</strong> means the workflow has not been
              marked reviewed. Open it to review the steps and manage its
              enabled state.
            </p>
            <Link href="/our-klaviyo/audiences">
              View customer message history →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
