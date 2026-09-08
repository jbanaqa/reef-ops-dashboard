/* eslint-disable react/no-unescaped-entities */
"use client";
import { useMemo, useState } from "react";
import { Content, content as normalizeContent, defaultContent, MarketingSettings, render } from "@/lib/marketing/rules";
import { FlowMap, Node, flowNodes } from "./FlowMap";

type Step = { minutes: number; subject: string; channel: string; content: Content };
type Branch = { subject: string; content: Content };
type Data = { reviewed?: boolean; description?: string; steps: Step[]; smsContent?: Content; orderBranch?: { yes: Branch; no: Branch } };
type Resource = { key: string; name: string; enabled: boolean; data: Record<string, unknown> };
type Target = { kind: "step" | "sms" | "branch" | "wait" | "info"; index?: number; branch?: "yes" | "no" };
type Value = string | number | undefined;

export default function FlowEditor({ resource, busy, save, settings }: { resource: Resource; busy: boolean; save: (data: Data, enabled: boolean) => void; settings: MarketingSettings }) {
  const initial = resource.data as unknown as Data;
  const [flow, setFlow] = useState<Data>(() => JSON.parse(JSON.stringify(initial)));
  const [enabled, setEnabled] = useState(resource.enabled);
  const [selected, setSelected] = useState<{ node: Node; target: Target } | null>(null);
  const nodes = useMemo(() => flowNodes(resource), [resource]);
  const targetFor = (n: Node): Target => {
    if (n.kind === "wait") return { kind: "wait", index: nodes.slice(0, nodes.indexOf(n)).filter(x => x.kind === "wait").length };
    if (n.kind === "sms") return { kind: "sms" };
    if (n.kind !== "email") return { kind: "info" };
    if (n.label.includes("Another Soft Push")) return { kind: "branch", branch: "yes" };
    if (n.label.includes("Discount Offer")) return { kind: "branch", branch: "no" };
    return { kind: "step", index: Math.min(nodes.slice(0, nodes.indexOf(n)).filter(x => x.kind === "email").length, Math.max(0, flow.steps.length - 1)) };
  };
  const updateStep = (i: number, patch: Partial<Step>) => setFlow(f => ({ ...f, steps: f.steps.map((s, n) => n === i ? { ...s, ...patch } : s) }));
  const updateContent = (target: Target, key: keyof Content, value: Value) => setFlow(f => {
    if (target.kind === "sms") return { ...f, smsContent: { ...(f.smsContent || defaultContent), [key]: value } };
    if (target.kind === "step") return { ...f, steps: f.steps.map((s, i) => i === target.index ? { ...s, content: { ...s.content, [key]: value } } : s) };
    if (target.kind === "branch" && f.orderBranch && target.branch) return { ...f, orderBranch: { ...f.orderBranch, [target.branch]: { ...f.orderBranch[target.branch], content: { ...f.orderBranch[target.branch].content, [key]: value } } } };
    return f;
  });
  const content = selected?.target.kind === "sms" ? (flow.smsContent || defaultContent) : selected?.target.kind === "step" ? flow.steps[selected.target.index || 0]?.content : selected?.target.kind === "branch" && selected.target.branch ? flow.orderBranch?.[selected.target.branch]?.content : null;
  const step = selected?.target.kind === "step" ? flow.steps[selected.target.index || 0] : null;
  const branch = selected?.target.kind === "branch" && selected.target.branch ? flow.orderBranch?.[selected.target.branch] : null;
  const preview = content ? render(normalizeContent(content), "#unsubscribe", settings.postalAddress, undefined, settings.organizationName) : "";
  const setSubject = (value: string) => {
    if (!selected) return;
    if (selected.target.kind === "step") updateStep(selected.target.index || 0, { subject: value });
    if (selected.target.kind === "branch" && selected.target.branch) setFlow(f => ({ ...f, orderBranch: { ...f.orderBranch!, [selected.target.branch!]: { ...f.orderBranch![selected.target.branch!], subject: value } } }));
  };
  const fields = (c: Content, target: Target) => <>
    {(target.kind === "step" || target.kind === "branch") && <label>Subject<input value={(target.kind === "step" ? step?.subject : branch?.subject) || ""} onChange={e => setSubject(e.target.value)} /></label>}
    <label>Heading<input value={c.heading || ""} onChange={e => updateContent(target, "heading", e.target.value)} /></label>
    <label>Copy format<select value={c.bodyHtml !== undefined ? "html" : "plain"} onChange={e => updateContent(target, "bodyHtml", e.target.value === "html" ? (c.bodyHtml || "") : undefined)}><option value="plain">Plain text with automatic links</option><option value="html">Formatted HTML (advanced)</option></select></label>
    {c.bodyHtml !== undefined ? <label key="html-copy-editor">Message HTML <small>Use simple email tags such as &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;a href=&quot;https://...&quot;&gt;, and lists. Scripts and unsafe links are removed automatically.</small><textarea rows={10} value={c.bodyHtml} onChange={e => updateContent(target, "bodyHtml", e.target.value)} /></label> : <label key="plain-copy-editor">Message<textarea rows={6} value={c.body || ""} onChange={e => updateContent(target, "body", e.target.value)} /></label>}
    <div className="mk-two"><label>Button text<input value={c.button || ""} onChange={e => updateContent(target, "button", e.target.value)} /></label><label>Button destination <small>Must be an HTTPS link. This is used by the orange CTA and the plain-text link.</small><input value={c.url || ""} onChange={e => updateContent(target, "url", e.target.value)} /></label></div>
  </>;
  const imageFields = (c: Content, target: Target) => c.template !== "b2b-wholesale" ? null : <div className="mk-image-fields"><p className="mk-modal-label">Brand artwork</p><p className="mk-modal-help">The logo fills the white header. The footer image is the Klaviyo artwork shown in the blue footer (“Thank you for your business” and the heart). Uploading it replaces the placeholder text.</p><label>Logo image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => updateContent(target, "logo", String(reader.result)); reader.readAsDataURL(file); } }} /></label><label className="mk-scale-control">Logo scale <span>{(c.logoScale || 1).toFixed(1)}×</span><input type="range" min="0.25" max="2.5" step="0.1" value={c.logoScale || 1} onChange={e => updateContent(target, "logoScale", Number(e.target.value))} /></label><label>Footer image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => updateContent(target, "footerImage", String(reader.result)); reader.readAsDataURL(file); } }} /></label><label className="mk-scale-control">Footer artwork scale <span>{(c.footerScale || 1).toFixed(1)}×</span><input type="range" min="0.25" max="2.5" step="0.1" value={c.footerScale || 1} onChange={e => updateContent(target, "footerScale", Number(e.target.value))} /></label></div>;
  return <article className="mk-panel"><div className="mk-flow-editor-heading"><div><h2>Edit {resource.name}</h2><p>{flow.description}</p></div><span className="mk-flow-editor-hint">Click any step to edit it</span></div><div className="mk-flow-note"><strong>How this works</strong><span>Follow the timeline from top to bottom. Click a block to view or edit its settings.</span></div><FlowMap resource={resource} onNodeClick={n => setSelected({ node: n, target: targetFor(n) })} /><div className="mk-flow-controls"><label className="mk-check"><input type="checkbox" checked={!!flow.reviewed} onChange={e => setFlow({ ...flow, reviewed: e.target.checked })} />I reviewed this flow's timing, consent rules, and purchase checks.</label><label className="mk-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable this flow</label><button disabled={busy} onClick={() => save(flow, enabled)}>Save flow</button></div>{selected && <div className="mk-modal-backdrop" onClick={() => setSelected(null)}><div className="mk-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><div className="mk-modal-header"><h3>{selected.node.label}</h3><button type="button" onClick={() => setSelected(null)}>Close</button></div>{selected.target.kind === "info" && <p className="mk-modal-explanation">{selected.node.detail || "Reef Ops evaluates this decision automatically before continuing."}</p>}{selected.target.kind === "wait" && <><p className="mk-modal-explanation">This pause gives the customer time before the next action.</p><label>Wait (minutes)<input type="number" min="0" value={step?.minutes || 0} onChange={e => updateStep(selected.target.index || 0, { minutes: Number(e.target.value) })} /></label></>}{content && fields(content, selected.target)}{content && imageFields(content, selected.target)}{preview && <div className="mk-email-preview"><p className="mk-modal-label">Live email preview</p><iframe title="Email preview" sandbox="" scrolling="no" srcDoc={preview} /></div>}{selected.target.kind === "sms" && <p className="mk-modal-explanation">SMS requires marketing consent and an unsuppressed profile.</p>}<div className="mk-modal-actions"><button type="button" onClick={() => setSelected(null)}>Done</button></div></div></div>}</article>;
}
