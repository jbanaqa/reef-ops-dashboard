import Link from "next/link";
import { getSpeciesDashboardData, parseSpeciesQueueFilters } from "@/lib/species-library-dashboard";
import { SpeciesReviewQueue } from "./SpeciesReviewQueue";

export const dynamic = "force-dynamic";

const stages = [
  ["1", "Product detected", "Active and draft products enter through Shopify webhooks or reconciliation."],
  ["2", "Match or draft", "ReefOps proposes an existing species link or a schema-valid new card."],
  ["3", "Human review", "Text, image, matching, and publication remain independently reviewable."],
  ["4", "Explicit publish", "Only an approved card can be sent to the Species Library publication target."],
] as const;

function queueHref(filters: { search: string; kind: string; confidence: string }, page: number) {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.kind !== "ALL") query.set("kind", filters.kind);
  if (filters.confidence !== "ALL") query.set("confidence", filters.confidence);
  if (page > 1) query.set("page", String(page));
  return `/species-library${query.size ? `?${query}` : ""}`;
}

export default async function SpeciesLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseSpeciesQueueFilters(await searchParams);
  const data = await getSpeciesDashboardData(filters);
  return <div className="page-stack species-page">
    <section><p className="page-header-eyebrow">Macroalgae Farms · Merchandising</p><h2 className="page-title">Species Library</h2><p className="page-description">Review product-to-species links and prepare complete species cards without allowing AI or Shopify events to publish automatically.</p></section>
    <section className="species-safety-banner"><div><span className="reef-live-dot" /><strong>Store isolation</strong></div><p>{data.databaseReady ? "Macroalgae Farms boundary and Species Library database are ready. Shopify events can only add approval-queue items." : data.configured ? "Macroalgae Farms boundary configured. Apply the database migration and import the approved cards next." : "Inactive until SPECIES_LIBRARY_SHOP_DOMAIN is configured for Macroalgae Farms."}</p></section>
    <section className="species-metrics" aria-label="Species queue summary">
      <article><span>Approved cards</span><strong>{data.approvedCards}</strong><p>Stored for Macroalgae Farms</p></article>
      <article><span>Awaiting review</span><strong>{data.awaitingReview}</strong><p>{data.queueSummary.linkExisting} links · {data.queueSummary.createCard} card candidates</p></article>
      <article><span>High-confidence links</span><strong>{data.queueSummary.highConfidence}</strong><p>At least 95%; still requires approval</p></article>
      <article><span>Published cards</span><strong>{data.publishedCards}</strong><p>No automatic publishing is permitted</p></article>
    </section>
    <section className="species-panel">
      <div className="species-panel-heading"><div><p className="page-header-eyebrow">Approval queue</p><h3>Human review workspace</h3></div><span className="species-status-pill">Approval required</span></div>
      <form className="species-queue-filters" method="get">
        <label><span>Search products</span><input type="search" name="search" defaultValue={data.filters.search} placeholder="Product title" /></label>
        <label><span>Recommendation</span><select name="kind" defaultValue={data.filters.kind}><option value="ALL">All types</option><option value="LINK_EXISTING">Link existing</option><option value="CREATE_CARD">Create card</option></select></label>
        <label><span>Confidence</span><select name="confidence" defaultValue={data.filters.confidence}><option value="ALL">All confidence</option><option value="HIGH">High · 95%+</option><option value="MEDIUM">Medium · 70–94%</option><option value="LOW">Low/manual</option></select></label>
        <button className="button-primary" type="submit">Apply filters</button>
        <Link className="button-secondary species-filter-reset" href="/species-library">Reset</Link>
      </form>
      <div className="species-filter-summary"><strong>{data.pagination.filteredCount}</strong><span>matching queue items</span><small>Page {data.pagination.page} of {data.pagination.totalPages}</small></div>
      <SpeciesReviewQueue items={data.recentItems} databaseReady={data.databaseReady} candidateCards={data.candidateCards} />
      {data.pagination.totalPages > 1 && <nav className="species-pagination" aria-label="Species review pages">
        {data.pagination.page > 1 ? <Link className="button-secondary" href={queueHref(data.filters, data.pagination.page - 1)}>Previous</Link> : <span />}
        <span>Showing {(data.pagination.page - 1) * data.pagination.pageSize + 1}–{Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.filteredCount)} of {data.pagination.filteredCount}</span>
        {data.pagination.page < data.pagination.totalPages ? <Link className="button-secondary" href={queueHref(data.filters, data.pagination.page + 1)}>Next</Link> : <span />}
      </nav>}
      <div className="species-flow">{stages.map(([number, title, description]) => <article key={number}><i>{number}</i><div><strong>{title}</strong><p>{description}</p></div></article>)}</div>
    </section>
  </div>;
}
