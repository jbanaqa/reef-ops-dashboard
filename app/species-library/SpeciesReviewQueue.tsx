"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ReviewQueueItem = {
  id: string; productTitle: string; kind: string; status: string;
  textStatus: string; imageStatus: string; matchConfidence: number | null;
  candidateCard: { commonName: string; scientificName: string } | null;
  draftPayload: unknown;
};

export function SpeciesReviewQueue({ items, databaseReady }: { items: ReviewQueueItem[]; databaseReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((item) => [item.id, item.draftPayload ? JSON.stringify(item.draftPayload, null, 2) : "{\n  \"id\": \"\",\n  \"commonName\": \"\",\n  \"scientificName\": \"\"\n}"])));

  async function act(item: ReviewQueueItem, action: string) {
    setBusy(item.id); setError("");
    try {
      let payload: unknown;
      if (action === "SAVE_DRAFT" || action === "APPROVE_CARD") payload = JSON.parse(drafts[item.id]);
      const response = await fetch(`/api/species-library/review/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, ...(body.details || [])].filter(Boolean).join(" "));
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review failed."); }
    finally { setBusy(null); }
  }

  async function generateText(item: ReviewQueueItem) {
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/species-library/generate-text/${item.id}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Text generation failed.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Text generation failed."); }
    finally { setBusy(null); }
  }

  if (!items.length) return <div className="species-empty-queue"><strong>{databaseReady ? "Queue is clear" : "Database activation pending"}</strong><p>{databaseReady ? "Product synchronization has not added any review items." : "No migration or import has been run from this workspace."}</p></div>;

  return <div className="species-review-workspace">
    {error && <p className="species-review-error">{error}</p>}
    {items.map((item) => <article className="species-review-card" key={item.id}>
      <header><div><strong>{item.productTitle}</strong><span>{item.kind.replaceAll("_", " ")}</span></div><div className="species-queue-status"><span>{item.status}</span><small>Text {item.textStatus}</small><small>Image {item.imageStatus}</small></div></header>
      {item.candidateCard && <div className="species-candidate"><span>Suggested existing card</span><strong>{item.candidateCard.commonName}</strong><em>{item.candidateCard.scientificName}</em><small>{item.matchConfidence ? `${Math.round(item.matchConfidence * 100)}% deterministic confidence` : "Manual review"}</small></div>}
      {item.kind === "CREATE_CARD" && <label className="species-json-editor"><span>New card JSON draft</span><textarea value={drafts[item.id]} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} spellCheck={false} /></label>}
      <footer>
        {item.kind === "LINK_EXISTING" && <button className="button-primary" disabled={busy === item.id} onClick={() => act(item, "APPROVE_LINK")}>Approve link</button>}
        {item.kind === "CREATE_CARD" && <><button className="button-secondary" disabled={busy === item.id} onClick={() => generateText(item)}>Generate text draft</button><button className="button-secondary" disabled={busy === item.id} onClick={() => act(item, "SAVE_DRAFT")}>Validate &amp; save</button><button className="button-primary" disabled={busy === item.id} onClick={() => act(item, "APPROVE_CARD")}>Approve card</button></>}
        <button className="button-secondary" disabled={busy === item.id} onClick={() => act(item, "REJECT")}>Reject</button>
      </footer>
    </article>)}
  </div>;
}
