"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type CandidateCard = { id: string; speciesKey: string; commonName: string; scientificName: string };
export type ReviewQueueItem = {
  id: string; productTitle: string; productHandle: string | null; kind: string; status: string;
  textStatus: string; imageStatus: string; matchConfidence: number | null; matchReasons: unknown;
  candidateCard: CandidateCard | null; draftPayload: unknown;
};

function reasonsText(value: unknown) {
  if (!value) return "No deterministic match reasons recorded.";
  if (Array.isArray(value)) return value.map(String).join(" · ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function SpeciesReviewQueue({ items, databaseReady, candidateCards }: { items: ReviewQueueItem[]; databaseReady: boolean; candidateCards: CandidateCard[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirmed, setBatchConfirmed] = useState(false);
  const [reassignments, setReassignments] = useState<Record<string, string>>(() => Object.fromEntries(items.map((item) => [item.id, item.candidateCard?.id || ""])));
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((item) => [item.id, item.draftPayload ? JSON.stringify(item.draftPayload, null, 2) : "{\n  \"id\": \"\",\n  \"commonName\": \"\",\n  \"scientificName\": \"\"\n}"])));
  const highConfidenceIds = useMemo(() => items.filter((item) => item.kind === "LINK_EXISTING" && item.candidateCard && (item.matchConfidence || 0) >= 0.95).map((item) => item.id), [items]);

  async function act(item: ReviewQueueItem, action: string) {
    setBusy(item.id); setError("");
    try {
      let payload: unknown;
      if (action === "SAVE_DRAFT" || action === "APPROVE_CARD") payload = JSON.parse(drafts[item.id]);
      const response = await fetch(`/api/species-library/review/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, candidateCardId: action === "REASSIGN_LINK" ? reassignments[item.id] : undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, ...(body.details || [])].filter(Boolean).join(" "));
      setSelected((current) => { const next = new Set(current); next.delete(item.id); return next; });
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review failed."); }
    finally { setBusy(null); }
  }

  async function generateText(item: ReviewQueueItem) {
    setBusy(item.id); setGenerating(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/species-library/generate-text/${item.id}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Text generation failed.");
      if (!body.result?.draft) throw new Error("Generation finished without returning a draft.");
      setDrafts((current) => ({ ...current, [item.id]: JSON.stringify(body.result.draft, null, 2) }));
      if (body.result.warnings?.length) setError(`Draft saved, but it still needs review: ${body.result.warnings.join("; ")}`);
      else setNotice(`${item.productTitle} draft generated and loaded below.`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Text generation failed."); }
    finally { setGenerating(null); setBusy(null); }
  }

  async function approveBatch() {
    if (!batchConfirmed || !selected.size) return;
    setBusy("batch"); setError("");
    try {
      const response = await fetch("/api/species-library/review/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [...selected], confirmation: "APPROVE_HIGH_CONFIDENCE_LINKS" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Batch approval failed.");
      setSelected(new Set()); setBatchConfirmed(false); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Batch approval failed."); }
    finally { setBusy(null); }
  }

  function toggleAllHighConfidence() {
    const allSelected = highConfidenceIds.length > 0 && highConfidenceIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(highConfidenceIds));
    setBatchConfirmed(false);
  }

  if (!items.length) return <div className="species-empty-queue"><strong>{databaseReady ? "No matching queue items" : "Database activation pending"}</strong><p>{databaseReady ? "Adjust the filters or wait for a new Shopify event." : "No migration or import has been run from this workspace."}</p></div>;

  return <div className="species-review-workspace">
    <div aria-live="polite">{generating && <p className="species-publication-message">Generating the species-card draft. This may take a moment…</p>}{notice && <p className="species-publication-message">{notice}</p>}{error && <p className="species-review-error">{error}</p>}</div>
    {highConfidenceIds.length > 0 && <div className="species-batch-bar">
      <button className="button-secondary" type="button" onClick={toggleAllHighConfidence}>{highConfidenceIds.every((id) => selected.has(id)) ? "Clear page selection" : `Select ${highConfidenceIds.length} high-confidence on page`}</button>
      <label><input type="checkbox" checked={batchConfirmed} onChange={(event) => setBatchConfirmed(event.target.checked)} /><span>I reviewed the selected product-to-card mappings</span></label>
      <button className="button-primary" type="button" disabled={!batchConfirmed || !selected.size || busy === "batch"} onClick={approveBatch}>Approve {selected.size} selected links</button>
    </div>}
    {items.map((item) => {
      const highConfidence = item.kind === "LINK_EXISTING" && !!item.candidateCard && (item.matchConfidence || 0) >= 0.95;
      return <article className="species-review-card" key={item.id} aria-busy={busy === item.id}>
        <header><div className="species-product-heading">{highConfidence && <input aria-label={`Select ${item.productTitle}`} type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />}<div><strong>{item.productTitle}</strong><span>{item.kind.replaceAll("_", " ")}{item.productHandle ? ` · ${item.productHandle}` : ""}</span></div></div><div className="species-queue-status"><span>{item.status}</span><small>Text {generating === item.id ? "GENERATING…" : item.textStatus}</small><small>Image {item.imageStatus}</small></div></header>
        {item.candidateCard && <div className="species-candidate"><span>Suggested existing card</span><strong>{item.candidateCard.commonName}</strong><em>{item.candidateCard.scientificName}</em><small>{item.matchConfidence ? `${Math.round(item.matchConfidence * 100)}% deterministic confidence` : "Manual review"}</small><p>{reasonsText(item.matchReasons)}</p></div>}
        <div className="species-reassign"><label><span>Link to a different existing card</span><select value={reassignments[item.id] || ""} onChange={(event) => setReassignments((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose an approved card</option>{candidateCards.map((card) => <option value={card.id} key={card.id}>{card.commonName} — {card.scientificName}</option>)}</select></label><button className="button-secondary" type="button" disabled={busy === item.id || !reassignments[item.id] || reassignments[item.id] === item.candidateCard?.id} onClick={() => act(item, "REASSIGN_LINK")}>Use selected card</button></div>
        {item.kind === "CREATE_CARD" && <label className="species-json-editor"><span>New card JSON draft</span><textarea value={drafts[item.id]} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} spellCheck={false} /></label>}
        <footer>
          {item.kind === "LINK_EXISTING" && <button className="button-primary" disabled={busy === item.id} onClick={() => act(item, "APPROVE_LINK")}>Approve link</button>}
          {item.kind === "CREATE_CARD" && <><button className="button-secondary" disabled={busy === item.id} onClick={() => generateText(item)}>{generating === item.id ? "Generating text…" : "Generate text draft"}</button><button className="button-secondary" disabled={busy === item.id} onClick={() => act(item, "SAVE_DRAFT")}>Validate &amp; save</button><button className="button-primary" disabled={busy === item.id} onClick={() => act(item, "APPROVE_CARD")}>Approve card</button></>}
          <button className="button-secondary" disabled={busy === item.id} onClick={() => act(item, "REJECT")}>Reject</button>
        </footer>
      </article>;
    })}
  </div>;
}
