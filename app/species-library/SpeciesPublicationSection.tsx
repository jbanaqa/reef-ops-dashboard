import { getSpeciesPublicationReadiness } from "@/lib/species-publication";
import { SpeciesPublicationControl } from "./SpeciesPublicationControl";

export async function SpeciesPublicationSection() {
  let readiness = { ready: false, cards: 0, canonicalCards: 0, newCards: 0, pendingCommerce: 0, blockReason: "Publication readiness could not be verified." as string | null, lastPublishedAt: null as string | null };
  try { if (process.env.DATABASE_URL && process.env.SPECIES_LIBRARY_SHOP_DOMAIN) readiness = await getSpeciesPublicationReadiness(); }
  catch (error) { console.warn("Species publication is waiting for database setup:", error); }
  return <section className="species-panel"><div className="species-panel-heading"><div><p className="page-header-eyebrow">Controlled release</p><h3>Publish to Shopify</h3></div><span className="species-status-pill">Explicit action</span></div><p className="page-description">Writes one versioned, ordered JSON snapshot to numbered <code>shop.metafields.reef_ops</code> chunks plus a manifest. Product webhooks and commerce approvals never call this automatically.</p><SpeciesPublicationControl ready={readiness.ready} cards={readiness.cards} canonicalCards={readiness.canonicalCards} newCards={readiness.newCards} pendingCommerce={readiness.pendingCommerce} blockReason={readiness.blockReason} lastPublishedAt={readiness.lastPublishedAt} /></section>;
}
