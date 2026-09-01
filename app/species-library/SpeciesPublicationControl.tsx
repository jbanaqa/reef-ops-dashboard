"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SpeciesPublicationControl({ ready, upToDate, cards, changedCards, canonicalCards, newCards, pendingCommerce, blockReason, lastPublishedAt }: { ready: boolean; upToDate: boolean; cards: number; changedCards: number; canonicalCards: number; newCards: number; pendingCommerce: number; blockReason: string | null; lastPublishedAt: string | null }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function publish() {
    if (!confirmed) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/species-library/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "PUBLISH_SPECIES_LIBRARY" }) });
      const body = await response.json();
      if (!response.ok) throw new Error([body.error, ...(body.details || []).map((detail: { message?: string }) => detail.message)].filter(Boolean).join(" "));
      setMessage(`Published ${body.result.changedCards} changed card version${body.result.changedCards === 1 ? "" : "s"} in the complete ${body.result.cards}-card Shopify snapshot.`); setConfirmed(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Publication failed."); }
    finally { setBusy(false); }
  }
  return <div className="species-publication-control"><div><strong>{ready ? `${changedCards} changed card${changedCards === 1 ? "" : "s"} ready` : upToDate ? "Up to date" : "Publication blocked"}</strong><p>{blockReason || (pendingCommerce ? `${pendingCommerce} commerce decision${pendingCommerce === 1 ? "" : "s"} still need review.` : upToDate ? `Shopify already has the latest version of all ${cards} approved cards.` : `The original ${canonicalCards} cards will retain their canonical order${newCards ? `; ${newCards} new card${newCards === 1 ? "" : "s"} will be appended` : ""}.`)}</p>{lastPublishedAt && <small>Last recorded publication: {new Date(lastPublishedAt).toLocaleString()}</small>}</div><label><input type="checkbox" checked={confirmed} disabled={!ready || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the pending commerce decisions and want to publish the complete library snapshot.</span></label><button className="button-primary" disabled={!ready || !confirmed || busy} onClick={publish}>{busy ? "Publishing…" : `Publish ${changedCards} change${changedCards === 1 ? "" : "s"}`}</button>{message && <p className="species-publication-message">{message}</p>}</div>;
}
