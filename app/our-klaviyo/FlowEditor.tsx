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
} from "@/lib/marketing/rules";
import { FlowMap, Node } from "./FlowMap";
import EmailDesigner from "./EmailDesigner";
import { readDraft, writeDraft } from "./flow-drafts";

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
  id?: string;
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
  save: (data: Data, enabled: boolean) => void | Promise<unknown>;
  settings: MarketingSettings;
  testEmail?: (
    to: string,
    subject: string,
    content: Content,
  ) => void | Promise<unknown>;
}) {
  const initial = resource.data as unknown as Data;
  const [flow, setFlow] = useState<Data>(() =>
    JSON.parse(JSON.stringify(initial)),
  );
  const [enabled, setEnabled] = useState(resource.enabled);
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
          setFlow(draft.flow);
          setEnabled(draft.enabled);
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
            setFlow(JSON.parse(JSON.stringify(resource.data)) as Data);
            setEnabled(resource.enabled);
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
            onTest={testEmail}
            organizationName={settings.organizationName}
            postalAddress={settings.postalAddress}
          />
        ) : (
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
                    Minutes after the triggering event. This is not an
                    additional delay after the previous step.
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
            </div>
          </div>
        ))}
    </article>
  );
}

export default function FlowEditor(
  props: Parameters<typeof FlowEditorState>[0],
) {
  return <FlowEditorState key={props.resource.key} {...props} />;
}
