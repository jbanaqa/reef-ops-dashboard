"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ApprovedCardOption = { id: string; speciesKey: string; commonName: string; scientificName: string };
type LoadedCard = ApprovedCardOption & { group: string; payload: unknown; productLinkCount: number; latestVersion: number; isPublished: boolean; updatedAt: string };

export function ApprovedCardEditor({ cards }: { cards: ApprovedCardOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState<LoadedCard | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(id: string) {
    setSelectedId(id); setLoaded(null); setDraft(""); setConfirmed(false); setError(""); setNotice("");
    if (!id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/species-library/cards/${id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load the approved card.");
      setLoaded(body.card); setDraft(JSON.stringify(body.card.payload, null, 2));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load the approved card."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!loaded || !confirmed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = JSON.parse(draft);
      if (payload.id !== loaded.speciesKey) throw new Error(`The id must remain ${loaded.speciesKey}.`);
      const response = await fetch(`/api/species-library/cards/${loaded.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, confirmation: "SAVE_NEW_CARD_VERSION" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, ...(body.details || [])].filter(Boolean).join(" "));
      setConfirmed(false);
      setNotice(`${loaded.commonName} saved as version ${body.result.version}. All product mappings were preserved. Publish the approved snapshot when you want this version on the storefront.`);
      await loadAfterSave(loaded.id);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the card."); }
    finally { setBusy(false); }
  }

  async function loadAfterSave(id: string) {
    const response = await fetch(`/api/species-library/cards/${id}`);
    const body = await response.json();
    if (response.ok) { setLoaded(body.card); setDraft(JSON.stringify(body.card.payload, null, 2)); }
  }

  if (!cards.length) return <div className="species-empty-queue"><strong>No approved cards available</strong><p>Approve or import a card before editing it.</p></div>;
  return <div className="species-approved-editor">
    <div className="species-toast-stack" aria-live="polite">{notice && <p className="species-publication-message">{notice}</p>}{error && <p className="species-review-error">{error}</p>}</div>
    <label className="species-card-picker"><span>Approved card</span><select value={selectedId} disabled={busy} onChange={(event) => load(event.target.value)}><option value="">Choose a card to edit</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.commonName} — {card.scientificName}</option>)}</select></label>
    {busy && !loaded && <p className="species-publication-message">Loading card…</p>}
    {loaded && <article className="species-approved-card" aria-busy={busy}>
      <header><div><strong>{loaded.commonName}</strong><em>{loaded.scientificName}</em></div><span>Version {loaded.latestVersion} · {loaded.productLinkCount} product mapping{loaded.productLinkCount === 1 ? "" : "s"}</span></header>
      <div className="species-edit-safeguards"><span>Locked ID: <code>{loaded.speciesKey}</code></span><span>{loaded.isPublished ? "This version is currently published" : "Unpublished changes exist"}</span><span>Commerce fields are preserved by Commerce review</span></div>
      <label className="species-json-editor"><span>Approved card JSON</span><textarea value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setConfirmed(false); }} spellCheck={false} /></label>
      <footer><label className="species-edit-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed these changes and want to create a new version of this existing card.</span></label><button className="button-primary" disabled={busy || !confirmed} onClick={save}>{busy ? "Saving version…" : "Validate & save new version"}</button></footer>
    </article>}
  </div>;
}
