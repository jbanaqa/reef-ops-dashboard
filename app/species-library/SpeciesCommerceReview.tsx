"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type CommerceCard = { id: string; commonName: string; scientificName: string; mode: string; searchQuery: string; shopUrl: string; links: Array<{ title: string; handle: string | null }> };

export function SpeciesCommerceReview({ cards }: { cards: CommerceCard[] }) {
  const router = useRouter();
  const [queries, setQueries] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((card) => [card.id, card.searchQuery])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function save(card: CommerceCard, mode: "DIRECT" | "SEARCH" | "UNAVAILABLE") {
    setBusy(card.id); setError("");
    try {
      const response = await fetch(`/api/species-library/commerce/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, productHandle: mode === "DIRECT" ? card.links[0]?.handle : null, searchQuery: mode === "SEARCH" ? queries[card.id] : null }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Commerce review failed.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Commerce review failed."); }
    finally { setBusy(null); }
  }

  if (!cards.length) return <div className="species-empty-queue"><strong>No commerce decisions waiting</strong><p>Approving or changing a product link will place its card here.</p></div>;
  return <div className="species-commerce-list">{error && <p className="species-review-error">{error}</p>}{cards.map((card) => {
    const recommended = card.links.length === 1 ? "DIRECT" : card.links.length > 1 ? "SEARCH" : "UNAVAILABLE";
    const preview = recommended === "SEARCH" && queries[card.id] ? `https://www.macroalgaefarms.com/search?q=${encodeURIComponent(queries[card.id])}&type=product` : recommended === "DIRECT" && card.links[0]?.handle ? `https://www.macroalgaefarms.com/products/${encodeURIComponent(card.links[0].handle)}` : "";
    return <article className="species-commerce-card" key={card.id}><header><div><strong>{card.commonName}</strong><em>{card.scientificName}</em></div><span>{card.links.length} linked product{card.links.length === 1 ? "" : "s"}</span></header><ul>{card.links.length ? card.links.map((link) => <li key={`${link.handle}-${link.title}`}>{link.title}</li>) : <li>No approved products linked</li>}</ul>{recommended === "SEARCH" && <label><span>Storefront search phrase</span><input value={queries[card.id] || ""} onChange={(event) => setQueries((current) => ({ ...current, [card.id]: event.target.value }))} placeholder="e.g. tube anemone" /></label>}<div className="species-commerce-actions">{preview && <a className="button-secondary" href={preview} target="_blank" rel="noreferrer">Preview storefront results</a>}<button className="button-primary" disabled={busy === card.id || (recommended === "SEARCH" && !queries[card.id]?.trim())} onClick={() => save(card, recommended)}>Approve {recommended.toLowerCase()}</button></div><small>Current legacy behavior: {card.mode.toLowerCase()} · {card.shopUrl || "no URL"}</small></article>;
  })}</div>;
}
