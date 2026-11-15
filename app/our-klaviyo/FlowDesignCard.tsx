"use client";
import { useEffect, useRef, useState } from "react";
import { useMarketingAction, useMarketingBrand } from "./MarketingBrand";
import type { FlowDesignPreview } from "@/lib/marketing/flow-design-rollout";

type Result = { operationId: string; done: boolean; flows: number; emails: number; messages: number; runs: number };
export default function FlowDesignCard({ refresh }: { refresh: () => Promise<void> }) {
  const { marketingFetch } = useMarketingBrand(), action = useMarketingAction();
  const [preview, setPreview] = useState<FlowDesignPreview | null>(null), [sampleKey, setSampleKey] = useState("");
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function loadPreview() {
    setBusy("preview"); setError("");
    try {
      const response = await marketingFetch("/api/marketing?view=flow-design-preview"), body = await response.json();
      if (!response.ok) throw Error(body.error || "Could not preview the flow design.");
      if (!active.current) return;
      setPreview(body); setSampleKey(body.samples[0]?.key || ""); setResult(null);
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "Could not preview the flow design."); }
    finally { if (active.current) setBusy(""); }
  }
  async function applyDesign() {
    if (!preview) return;
    setBusy("apply"); setError("");
    try {
      let next: Result;
      do {
        next = await action<Result>({ action: "apply-flow-design", fingerprint: preview.fingerprint });
        if (!active.current) return;
        setResult(next);
      } while (!next.done);
      await refresh();
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "The design update paused. You can continue it."); }
    finally { if (active.current) setBusy(""); }
  }
  const selected = preview?.samples.find(sample => sample.key === sampleKey) || preview?.samples[0];
  return <section className="sw-card">
    <div className="sw-card-title"><div><h3>Flow email design</h3><p>Preview the new Corals Anonymous look, then apply it to flow emails.</p></div></div>
    <div className="sw-actions">
      <button disabled={!!busy} onClick={() => void loadPreview()}>{busy === "preview" ? "Loading preview…" : preview ? "Refresh preview" : "Preview new design"}</button>
      {preview && <button className="sw-primary" disabled={!!busy || !!result?.done || !preview.emailCount} onClick={() => void applyDesign()}>
        {busy === "apply" ? "Applying design…" : result?.done ? "Design applied" : result ? "Continue applying" : "Apply to flow emails"}
      </button>}
    </div>
    {error && <p className="sw-alert" role="alert">{error}</p>}
    {preview && <>
      <p>{preview.emailCount} emails across {preview.flowCount} flows. Timing, audiences and sending preferences stay the same.</p>
      <p>Product cards and personal codes in this preview are examples.</p>
      {result && <p role="status">{result.done ? "Design applied." : "Updating waiting emails…"} {result.messages} waiting emails updated.</p>}
      {selected && <><label>Email to preview<select value={selected.key} onChange={event => setSampleKey(event.target.value)}>
        {preview.samples.map(sample => <option key={sample.key} value={sample.key}>{sample.label}</option>)}
      </select></label><iframe title="Flow email design preview" sandbox="" srcDoc={selected.html}
        style={{ display: "block", width: "100%", height: 650, marginTop: 16, border: "1px solid #d4e5e8", borderRadius: 10, background: "#fff" }} /></>}
    </>}
  </section>;
}
