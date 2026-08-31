import { getSpeciesDashboardData } from "@/lib/species-library-dashboard";
import { SpeciesReviewQueue } from "./SpeciesReviewQueue";

export const dynamic = "force-dynamic";

const stages = [
  ["1", "Product detected", "Active and draft products enter through Shopify webhooks or reconciliation."],
  ["2", "Match or draft", "ReefOps proposes an existing species link or a schema-valid new card."],
  ["3", "Human review", "Text, image, matching, and publication remain independently reviewable."],
  ["4", "Explicit publish", "Only an approved card can be sent to the Species Library publication target."],
] as const;

export default async function SpeciesLibraryPage() {
  const data = await getSpeciesDashboardData();
  return <div className="page-stack species-page">
    <section><p className="page-header-eyebrow">Macroalgae Farms · Merchandising</p><h2 className="page-title">Species Library</h2><p className="page-description">Review product-to-species links and prepare complete species cards without allowing AI or Shopify events to publish automatically.</p></section>
    <section className="species-safety-banner"><div><span className="reef-live-dot" /><strong>Store isolation</strong></div><p>{data.databaseReady ? "Macroalgae Farms boundary and Species Library database are ready. Shopify sync remains disabled." : data.configured ? "Macroalgae Farms boundary configured. Apply the database migration and import the approved cards next." : "Inactive until SPECIES_LIBRARY_SHOP_DOMAIN is configured for the separate Macroalgae Farms deployment."}</p></section>
    <section className="species-metrics" aria-label="Species queue summary">
      <article><span>Approved cards</span><strong>{data.approvedCards}</strong><p>{data.databaseReady ? "Stored for Macroalgae Farms" : "202 cards packaged for import"}</p></article>
      <article><span>Awaiting review</span><strong>{data.awaitingReview}</strong><p>Links and new cards needing approval</p></article>
      <article><span>Published cards</span><strong>{data.publishedCards}</strong><p>No automatic publishing is permitted</p></article>
      <article><span>Schema</span><strong>v{data.schemaVersion}</strong><p>Core plus group-specific fields</p></article>
    </section>
    <section className="species-panel">
      <div className="species-panel-heading"><div><p className="page-header-eyebrow">Approval queue</p><h3>Human review workspace</h3></div><span className="species-status-pill">Approval required</span></div>
      <SpeciesReviewQueue items={data.recentItems} databaseReady={data.databaseReady} />
      <div className="species-flow">{stages.map(([number, title, description]) => <article key={number}><i>{number}</i><div><strong>{title}</strong><p>{description}</p></div></article>)}</div>
    </section>
  </div>;
}
