/* eslint-disable react/no-unescaped-entities */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  Content,
  content as normalizeContent,
  defaultContent,
  escapeHtml,
  MarketingSettings,
  render,
  withBranding,
} from "@/lib/marketing/rules";
import { FlowMap, Node } from "./FlowMap";
import EmailDesigner from "./EmailDesigner";
import FlowDialog from "./FlowDialog";
import CartTools from "./CartTools";
import { readDraft, writeDraft } from "./flow-drafts";

import { cartDraft, CartConfig } from "@/lib/marketing/cart-config";
import { FlowConfig, FlowTarget } from "@/lib/marketing/flow-config";

type Step = {
  minutes: number;
  subject: string;
  channel: string;
  content: Content;
};
type Branch = { subject: string; content: Content };
type Data = {
  cart?: CartConfig;
  reviewed?: boolean;
  description?: string;
  threshold?: number;
  internalProfileIds?: string[];
  steps: Step[];
  smsMinutes?: number;
  branchMinutes?: number;
  smsContent?: Content;
  orderBranch?: { yes: Branch; no: Branch };
};
type Resource = {
  id?: string;
  key: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
};
type Target = FlowTarget;
type Value = Content[keyof Content];
const startingHtml = (c: Content) =>
  c.bodyHtml !== undefined
    ? c.bodyHtml
    : c.body
        .split(String.fromCharCode(10))
        .slice(c.template === "b2b-wholesale" ? 2 : 0)
        .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : ""))
        .join("\n");

function FlowEditorState({
  resource,
  busy,
  save,
  settings,
  testEmail,
}: {
  resource: Resource;
  busy: boolean;
  save: (data: Data, enabled: boolean) => void | Promise<unknown>;
  settings: MarketingSettings;
  testEmail?: (
    to: string,
    subject: string,
    content: Content,
  ) => void | Promise<unknown>;
}) {
  const upgrade = (data: Data) =>
    resource.key === "abandoned-cart" ? cartDraft(data as FlowConfig) : data;
  const initial = upgrade(resource.data as unknown as Data);
  const [flow, setFlow] = useState<Data>(() =>
    JSON.parse(JSON.stringify(initial)),
  );
  const [enabled, setEnabled] = useState(
    resource.key === "abandoned-cart" && !resource.data.cart
      ? false
      : resource.enabled,
  );
  const latest = useRef({ flow, enabled });
  useEffect(() => {
    latest.current = { flow, enabled };
  }, [flow, enabled]);
  async function saveFlow() {
    const submitted = JSON.stringify({ flow, enabled });
    const result = (await save(flow, enabled)) as Resource | undefined;
    if (result?.data && JSON.stringify(latest.current) === submitted) {
      setFlow(result.data as unknown as Data);
      setEnabled(result.enabled);
      setDraftStatus("Flow saved, including copy and artwork.");
    }
    return !!result?.data;
  }
  const draftKey = resource.id || resource.key;
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Loading saved draft…");
  const writes = useRef(Promise.resolve());
  const savedSnapshot = JSON.stringify({
    flow: resource.data,
    enabled: resource.enabled,
  });
  useEffect(() => {
    let active = true;
    readDraft<{ flow: Data; enabled: boolean; base: string }>(draftKey)
      .then((draft) => {
        if (!active) return;
        if (
          draft &&
          draft.base !==
            JSON.stringify({ flow: draft.flow, enabled: draft.enabled })
        ) {
          setFlow(upgrade(draft.flow));
          setEnabled(
            resource.key === "abandoned-cart" && !draft.flow.cart
              ? false
              : draft.enabled,
          );
          setDraftStatus(
            draft.base === savedSnapshot
              ? "Restored unfinished draft. Save flow to apply it."
              : "Restored unfinished draft; the saved flow also changed. Review before saving.",
          );
        } else
          setDraftStatus(
            "Changes are kept as a draft in this browser. Save flow to apply them.",
          );
        setDraftReady(true);
      })
      .catch(() => {
        if (active) {
          setDraftStatus(
            "Browser draft storage is unavailable. Save flow before leaving.",
          );
          setDraftReady(true);
        }
      });
    return () => {
      active = false;
    };
    // Load once per resource. Server refreshes must not replace active edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    let active = true;
    writes.current = writes.current
      .catch(() => {})
      .then(() => writeDraft(draftKey, { flow, enabled, base: savedSnapshot }))
      .catch(() => {
        if (active)
          setDraftStatus(
            "Draft could not be stored. Save flow before leaving to protect your copy and artwork.",
          );
      });
    return () => {
      active = false;
    };
  }, [flow, enabled, draftReady, draftKey, savedSnapshot]);
  useEffect(() => {
    if (JSON.stringify({ flow, enabled }) === savedSnapshot) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [flow, enabled, savedSnapshot]);
  const [checks, setChecks] = useState<{
    ready: boolean;
    missing: string[];
    missingWebhooks: string[];
    views: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  async function checkSetup() {
    setChecking(true);
    setCheckError("");
    try {
      const r = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cart-readiness" }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Check failed");
      setChecks(result);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }
  const [selected, setSelected] = useState<{
    node: Node;
    target: Target;
  } | null>(null);
  const updateStep = (i: number, patch: Partial<Step>) =>
    setFlow((f) => ({
      ...f,
      steps: f.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)),
    }));
  const updateContent = (target: Target, key: keyof Content, value: Value) =>
    setFlow((f) => {
      if (target.kind === "sms")
        return {
          ...f,
          smsContent: { ...(f.smsContent || defaultContent), [key]: value },
        };
      if (target.kind === "step")
        return {
          ...f,
          steps: f.steps.map((s, i) =>
            i === target.index
              ? { ...s, content: { ...s.content, [key]: value } }
              : s,
          ),
        };
      if (target.kind === "branch" && f.orderBranch && target.branch)
        return {
          ...f,
          orderBranch: {
            ...f.orderBranch,
            [target.branch]: {
              ...f.orderBranch[target.branch],
              content: {
                ...f.orderBranch[target.branch].content,
                [key]: value,
              },
            },
          },
        };
      return f;
    });
  const rawContent =
    selected?.target.kind === "sms"
      ? flow.smsContent || defaultContent
      : selected?.target.kind === "step"
        ? flow.steps[selected.target.index || 0]?.content
        : selected?.target.kind === "branch" && selected.target.branch
          ? flow.orderBranch?.[selected.target.branch]?.content
          : null;
  const content = rawContent
    ? withBranding(rawContent, settings.branding)
    : rawContent;
  const step =
    selected?.target.kind === "step" || selected?.target.kind === "wait"
      ? flow.steps[selected.target.index || 0]
      : null;
  const branch =
    selected?.target.kind === "branch" && selected.target.branch
      ? flow.orderBranch?.[selected.target.branch]
      : null;
  let preview = "",
    previewError = "";
  try {
    if (content && selected?.node.kind !== "sms")
      preview = render(
        normalizeContent(
          flow.cart
            ? {
                ...content,
                products: Array.from(
                  { length: flow.cart.productCount },
                  (_, i) => ({
                    title:
                      i === 0
                        ? "Example coral from your cart"
                        : "Example recommended coral",
                    url: "https://coralsanonymous.com/cart",
                    price: "Sample product",
                  }),
                ),
                ...(selected?.target.branch === "no"
                  ? { couponCode: "AC300-PREVIEW" }
                  : {}),
              }
            : content,
        ),
        "#unsubscribe",
        settings.postalAddress,
        undefined,
        settings.organizationName,
        settings.branding,
      );
  } catch (error) {
    previewError =
      error instanceof Error ? error.message : "Preview unavailable";
  }
  const waitValue = selected?.target.timing
    ? (flow[selected.target.timing] ??
      (selected.target.timing === "smsMinutes" ? 30 : 1440))
    : (step?.minutes ?? 0);
  const setWait = (value: number) => {
    if (selected?.target.timing)
      setFlow((f) => ({ ...f, [selected.target.timing!]: value }));
    else updateStep(selected?.target.index ?? 0, { minutes: value });
  };
  const setSubject = (value: string) => {
    if (!selected) return;
    if (selected.target.kind === "step")
      updateStep(selected.target.index || 0, { subject: value });
    if (selected.target.kind === "branch" && selected.target.branch)
      setFlow((f) => ({
        ...f,
        orderBranch: {
          ...f.orderBranch!,
          [selected.target.branch!]: {
            ...f.orderBranch![selected.target.branch!],
            subject: value,
          },
        },
      }));
  };
  const fields = (c: Content, target: Target) => (
    <>
      {(target.kind === "step" || target.kind === "branch") && (
        <label>
          Subject
          <input
            value={
              (target.kind === "step" ? step?.subject : branch?.subject) || ""
            }
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
      )}
      {!(flow.cart && selected?.node.kind === "sms") && (
        <>
          <label>
            Heading
            <input
              value={c.heading || ""}
              onChange={(e) => updateContent(target, "heading", e.target.value)}
            />
          </label>
        </>
      )}
      {selected?.node.kind === "sms" ? (
        <label>
          Text message
          <textarea
            rows={6}
            value={c.body}
            onChange={(e) => {
              updateContent(target, "body", e.target.value);
              updateContent(target, "bodyHtml", undefined);
            }}
          />
        </label>
      ) : (
        <label key="html-copy-editor">
          Message HTML{" "}
          <small>
            Messages use HTML so you can control paragraphs, emphasis, colors,
            links, and lists. Use tags such as &lt;p&gt;, &lt;strong&gt;,
            &lt;em&gt;, and &lt;a href=&quot;https://...&quot;&gt;. Scripts and
            unsafe links are removed automatically.
          </small>
          <textarea
            rows={10}
            value={startingHtml(c)}
            onChange={(e) => updateContent(target, "bodyHtml", e.target.value)}
          />
        </label>
      )}
      {flow.cart && selected?.node.kind === "sms" ? (
        <p className="mk-cart-feed-note">
          The customer’s checkout link, Corals Anonymous sender name, and “Reply
          STOP to opt out” are added automatically.
        </p>
      ) : (
        <>
          <div className="mk-two">
            <label>
              Button text
              <input
                value={c.button || ""}
                onChange={(e) =>
                  updateContent(target, "button", e.target.value)
                }
              />
            </label>
            <label>
              Button destination{" "}
              <small>
                Must be an HTTPS link. This is used by the orange CTA and the
                plain-text link.
              </small>
              <input
                value={c.url || ""}
                onChange={(e) => updateContent(target, "url", e.target.value)}
              />
            </label>
          </div>{" "}
        </>
      )}
    </>
  );
  if (!draftReady) return <p>Loading saved draft…</p>;
  return (
    <article className="mk-panel">
      <div className="mk-flow-editor-heading">
        <div>
          <h2>Edit {resource.name}</h2>
          <p>{flow.description}</p>
        </div>
        <span className="mk-flow-editor-hint">Click any step to edit it</span>
      </div>
      <div className="mk-flow-note">
        <strong>How this works</strong>
        <span>
          Follow the timeline from top to bottom. Click a block to view or edit
          its settings.
        </span>
      </div>
      <FlowMap
        resource={{
          ...resource,
          data: flow as unknown as Record<string, unknown>,
        }}
        onNodeClick={(n) => setSelected({ node: n, target: n.target })}
      />
      {flow.cart && (
        <div className="mk-cart-feed-note">
          <button type="button" disabled={checking} onClick={checkSetup}>
            {checking ? "Checking…" : "Check Shopify connection"}
          </button>
          <p>
            This checks access and event connections without sending a message
            or creating a discount.
          </p>
          {checkError && <p role="alert">{checkError}</p>}
          {checks && (
            <>
              <strong>
                {checks.ready
                  ? "Shopify connection is ready for a test checkout."
                  : "Some setup is still needed."}
              </strong>
              {!!checks.missing.length && (
                <p>
                  Shopify app access needed: {checks.missing.join(", ")}. Update
                  the app’s access in Shopify.
                </p>
              )}
              {!!checks.missingWebhooks.length && (
                <p>
                  Connect checkout and order events using Connect Shopify events
                  in Settings.
                </p>
              )}
              <p>
                {checks.views
                  ? checks.views + " product views recorded in the last 3 days."
                  : "No product views recorded in the last 3 days. Connect the customer-events pixel before expecting most-viewed recommendations."}
              </p>
            </>
          )}
        </div>
      )}
      {flow.cart && <CartTools flow={flow as FlowConfig} />}
      {flow.cart && (
        <div className="mk-cart-feed-note">
          <strong>Test before going live</strong>
          <p>
            Saved audience:{" "}
            {(resource.data.cart as CartConfig | undefined)?.testEmail
              ? "Test email only · " +
                (resource.data.cart as CartConfig).testEmail
              : "All eligible customers"}
            {resource.enabled ? " · Flow enabled" : " · Flow paused"}.
          </p>
          <label className="mk-check">
            <input
              type="checkbox"
              checked={flow.cart.testEmail !== undefined}
              onChange={(e) => {
                setEnabled(false);
                setFlow((f) => ({
                  ...f,
                  reviewed: false,
                  cart: {
                    ...f.cart!,
                    testEmail: e.target.checked ? "" : undefined,
                  },
                }));
              }}
            />
            Restrict this flow to one test email
          </label>
          {flow.cart.testEmail !== undefined && (
            <label>
              Test account email
              <input
                type="email"
                value={flow.cart.testEmail}
                placeholder="you@example.com"
                onChange={(e) => {
                  setEnabled(false);
                  setFlow((f) => ({
                    ...f,
                    reviewed: false,
                    cart: { ...f.cart!, testEmail: e.target.value },
                  }));
                }}
              />
            </label>
          )}
          <p>
            {flow.cart.testEmail !== undefined
              ? "Only this account can enter or receive this flow. Tests send email only; SMS is skipped. Consent, purchase checks, delays and the 16-hour email limit still apply. Start a fresh checkout after saving and enabling the restricted flow."
              : "When enabled without this restriction, this flow can send to all eligible customers."}
          </p>
          <p>
            Save flow to apply these settings. Changing the test audience clears
            Enable and review in this draft. Ending test mode cancels remaining
            test messages when delivery is checked. This restriction applies
            only to Abandoned Cart.
          </p>
        </div>
      )}

      {resource.key === "low-stock" && (
        <div className="mk-two">
          <label>
            Inventory threshold
            <input
              type="number"
              min="0"
              value={flow.threshold ?? 5}
              onChange={(e) =>
                setFlow({ ...flow, threshold: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Internal recipient profile IDs (comma separated)
            <input
              value={(flow.internalProfileIds || []).join(", ")}
              onChange={(e) =>
                setFlow({
                  ...flow,
                  internalProfileIds: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      )}
      {flow.cart && (
        <p className="mk-cart-feed-note">
          Email and text consent are checked before sending. Existing Klaviyo
          automations should be paused before this flow goes live to avoid
          duplicate reminders. Saved email edits apply when waiting messages are
          prepared. A wait already in progress keeps its timing; later waits use
          the settings saved when they begin.
        </p>
      )}
      <p>{draftStatus}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              "Discard this browser draft and reload the last saved flow?",
            )
          ) {
            setFlow(upgrade(JSON.parse(JSON.stringify(resource.data)) as Data));
            setEnabled(
              resource.key === "abandoned-cart" && !resource.data.cart
                ? false
                : resource.enabled,
            );
            setDraftStatus("Loaded the last saved flow.");
          }
        }}
      >
        Discard draft and reload saved flow
      </button>
      <div className="mk-flow-controls">
        <label className="mk-check">
          <input
            type="checkbox"
            checked={!!flow.reviewed}
            onChange={(e) => setFlow({ ...flow, reviewed: e.target.checked })}
          />
          I reviewed this flow's timing, consent rules, and purchase checks.
        </label>
        <label className="mk-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable this flow
        </label>
        <button disabled={busy} onClick={saveFlow}>
          Save flow
        </button>
      </div>
      {selected &&
        (content && selected.node.kind !== "sms" ? (
          <EmailDesigner
            key={JSON.stringify(selected.target)}
            title={resource.name}
            subject={step?.subject || branch?.subject || ""}
            content={content}
            html={preview}
            previewError={previewError}
            busy={busy}
            status={draftStatus}
            onSubject={setSubject}
            onContent={(key, value) =>
              updateContent(selected.target, key, value)
            }
            onSave={saveFlow}
            onClose={() => setSelected(null)}
            onTest={
              testEmail
                ? (to, subject, c) =>
                    testEmail(
                      to,
                      subject,
                      flow.cart
                        ? {
                            ...c,
                            products: Array.from(
                              { length: flow.cart.productCount },
                              () => ({
                                title: "Example coral",
                                url: "https://coralsanonymous.com/cart",
                              }),
                            ),
                            ...(selected.target.branch === "no"
                              ? { couponCode: "AC300-PREVIEW" }
                              : {}),
                          }
                        : c,
                    )
                : undefined
            }
            recoveryLink={!!flow.cart}
            previewCaption={
              flow.cart
                ? "Example products shown. Each customer receives their own checkout link and available recommendations."
                : undefined
            }
            organizationName={settings.organizationName}
            postalAddress={settings.postalAddress}
          />
        ) : (
          <FlowDialog
            title={selected.node.label}
            close={() => setSelected(null)}
          >
            {selected.target.kind === "info" && (
              <p className="mk-modal-explanation">
                {selected.node.detail ||
                  "Reef Ops evaluates this decision automatically before continuing."}
              </p>
            )}
            {selected.target.section === "products" && flow.cart && (
              <div className="mk-cart-feed-note">
                <label>
                  Products per email
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={flow.cart.productCount}
                    onChange={(e) =>
                      setFlow((f) => ({
                        ...f,
                        cart: {
                          ...f.cart!,
                          version: 1,
                          productCount: Number(e.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <p>
                  Show available products from the customer’s current checkout
                  and cart activity over the last 90 days first, across all
                  categories. Fill remaining spaces by alternating best-selling
                  and most-viewed products from the last 3 days, without
                  duplicates.
                </p>
                <p>
                  Rankings use Reef Ops activity and completed Klaviyo history
                  imports. Use Preview customer products to check the selection
                  and connect tracking. Fewer products appear when there is not
                  enough recorded activity or available stock.
                </p>
              </div>
            )}
            {selected.target.section === "coupon" && (
              <div className="mk-cart-feed-note">
                <p>
                  10% off the entire order, no minimum purchase, and no
                  combining with other discounts. Each generated AC300- code is
                  single-use, activates during email preparation, and expires
                  after one year.
                </p>
                <p>
                  Shopify discount read/write access is needed. The offer waits
                  if a valid code cannot be created; preview codes are never
                  used for customer deliveries.
                </p>
              </div>
            )}
            {selected.target.kind === "wait" && (
              <>
                <p className="mk-modal-explanation">
                  {flow.cart
                    ? "Minutes after the previous step. Quiet hours can move the text and following emails later."
                    : "Minutes after the triggering event, not after the previous step."}
                </p>
                <label>
                  Wait (minutes)
                  <input
                    type="number"
                    min="0"
                    value={waitValue}
                    onChange={(e) => setWait(Number(e.target.value))}
                  />
                </label>
              </>
            )}
            {content && fields(content, selected.target)}
            {selected.target.kind === "sms" && (
              <p className="mk-modal-explanation">
                SMS requires marketing consent and an unsuppressed profile.
              </p>
            )}
            <p>{draftStatus}</p>
            <div className="mk-modal-actions">
              <button type="button" disabled={busy} onClick={saveFlow}>
                Save flow
              </button>
              <button type="button" onClick={() => setSelected(null)}>
                Close editor
              </button>
            </div>
          </FlowDialog>
        ))}
    </article>
  );
}

export default function FlowEditor(
  props: Parameters<typeof FlowEditorState>[0],
) {
  return <FlowEditorState key={props.resource.key} {...props} />;
}
