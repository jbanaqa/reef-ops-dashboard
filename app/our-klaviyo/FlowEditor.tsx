/* eslint-disable react/no-unescaped-entities */
"use client";
import { useState } from "react";
import {
  Content,
  content as normalizeContent,
  defaultContent,
  escapeHtml,
  MarketingSettings,
  render,
} from "@/lib/marketing/rules";
import { FlowMap, Node } from "./FlowMap";

import { FlowTarget } from "@/lib/marketing/flow-config";

type Step = {
  minutes: number;
  subject: string;
  channel: string;
  content: Content;
};
type Branch = { subject: string; content: Content };
type Data = {
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
  key: string;
  name: string;
  enabled: boolean;
  data: Record<string, unknown>;
};
type Target = FlowTarget;
type Value = string | number | undefined;
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
  save: (data: Data, enabled: boolean) => void;
  settings: MarketingSettings;
  testEmail?: (to: string, subject: string, content: Content) => void;
}) {
  const initial = resource.data as unknown as Data;
  const [flow, setFlow] = useState<Data>(() =>
    JSON.parse(JSON.stringify(initial)),
  );
  const [mobile, setMobile] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [enabled, setEnabled] = useState(resource.enabled);
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
  const content =
    selected?.target.kind === "sms"
      ? flow.smsContent || defaultContent
      : selected?.target.kind === "step"
        ? flow.steps[selected.target.index || 0]?.content
        : selected?.target.kind === "branch" && selected.target.branch
          ? flow.orderBranch?.[selected.target.branch]?.content
          : null;
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
        normalizeContent(content),
        "#unsubscribe",
        settings.postalAddress,
        undefined,
        settings.organizationName,
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
      <label>
        Heading
        <input
          value={c.heading || ""}
          onChange={(e) => updateContent(target, "heading", e.target.value)}
        />
      </label>
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
      <div className="mk-two">
        <label>
          Button text
          <input
            value={c.button || ""}
            onChange={(e) => updateContent(target, "button", e.target.value)}
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
      </div>
    </>
  );
  const imageFields = (c: Content, target: Target) =>
    c.template !== "b2b-wholesale" ? null : (
      <div className="mk-image-fields">
        <p className="mk-modal-label">Brand artwork</p>
        <p className="mk-modal-help">
          The logo fills the white header. The footer image is the Klaviyo
          artwork shown in the blue footer (“Thank you for your business” and
          the heart). Uploading it replaces the placeholder text.
        </p>
        <label>
          Logo image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = () =>
                  updateContent(target, "logo", String(reader.result));
                reader.readAsDataURL(file);
              }
            }}
          />
        </label>
        {c.logo && (
          <button
            type="button"
            className="mk-remove-image"
            onClick={() => updateContent(target, "logo", undefined)}
          >
            Remove logo
          </button>
        )}
        <label className="mk-scale-control">
          Logo scale <span>{(c.logoScale || 1).toFixed(1)}×</span>
          <input
            type="range"
            min="0.25"
            max="2.5"
            step="0.1"
            value={c.logoScale || 1}
            onChange={(e) =>
              updateContent(target, "logoScale", Number(e.target.value))
            }
          />
        </label>
        <label>
          Footer image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = () =>
                  updateContent(target, "footerImage", String(reader.result));
                reader.readAsDataURL(file);
              }
            }}
          />
        </label>
        {c.footerImage && (
          <button
            type="button"
            className="mk-remove-image"
            onClick={() => updateContent(target, "footerImage", undefined)}
          >
            Remove footer artwork
          </button>
        )}
        <label className="mk-scale-control">
          Footer artwork scale <span>{(c.footerScale || 1).toFixed(1)}×</span>
          <input
            type="range"
            min="0.25"
            max="2.5"
            step="0.1"
            value={c.footerScale || 1}
            onChange={(e) =>
              updateContent(target, "footerScale", Number(e.target.value))
            }
          />
        </label>
      </div>
    );
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
        <button disabled={busy} onClick={() => save(flow, enabled)}>
          Save flow
        </button>
      </div>
      {selected && (
        <div className="mk-modal-backdrop" onClick={() => setSelected(null)}>
          <div
            className="mk-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mk-modal-header">
              <h3>{selected.node.label}</h3>
              <button type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            {selected.target.kind === "info" && (
              <p className="mk-modal-explanation">
                {selected.node.detail ||
                  "Reef Ops evaluates this decision automatically before continuing."}
              </p>
            )}
            {selected.target.kind === "wait" && (
              <>
                <p className="mk-modal-explanation">
                  Minutes after the triggering event. This is not an additional
                  delay after the previous step.
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
            {content && imageFields(content, selected.target)}
            {previewError && <p role="status">{previewError}</p>}
            {content && preview && testEmail && (
              <div>
                <label>
                  Internal test recipient
                  <input
                    type="email"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !recipient}
                  onClick={() =>
                    testEmail(
                      recipient,
                      step?.subject || branch?.subject || resource.name,
                      content,
                    )
                  }
                >
                  Send test email
                </button>
                <small>
                  Uses the current editor content. Recipient must be allowlisted
                  in Settings configuration.
                </small>
              </div>
            )}
            {preview && (
              <div className="mk-email-preview">
                <p className="mk-modal-label">Live email preview</p>
                <button type="button" onClick={() => setMobile(!mobile)}>
                  {mobile ? "Desktop preview" : "Mobile preview"}
                </button>
                <iframe
                  style={{ width: mobile ? 320 : "100%", maxWidth: "100%" }}
                  title="Email preview"
                  sandbox=""
                  scrolling="no"
                  srcDoc={preview}
                />
              </div>
            )}
            {selected.target.kind === "sms" && (
              <p className="mk-modal-explanation">
                SMS requires marketing consent and an unsuppressed profile.
              </p>
            )}
            <div className="mk-modal-actions">
              <button type="button" onClick={() => setSelected(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function FlowEditor(
  props: Parameters<typeof FlowEditorState>[0],
) {
  return <FlowEditorState key={props.resource.key} {...props} />;
}
