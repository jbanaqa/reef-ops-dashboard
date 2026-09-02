import { assertSpeciesLibraryShop } from "@/lib/species-library";
import { normalizeLegacyCommerce } from "@/lib/species-commerce";
import { SpeciesCommerceReview, type CommerceCard } from "./SpeciesCommerceReview";

export async function SpeciesCommerceSection() {
  let cards: CommerceCard[] = [];
  let pending = 0;
  try {
    if (process.env.DATABASE_URL && process.env.SPECIES_LIBRARY_SHOP_DOMAIN) {
      const shop = assertSpeciesLibraryShop();
      const { prisma } = await import("@/lib/prisma");
      pending = await prisma.speciesLibraryCard.count({ where: { shop, commerceReviewStatus: "NEEDS_REVIEW" } });
      const rows = await prisma.speciesLibraryCard.findMany({ where: { shop, commerceReviewStatus: "NEEDS_REVIEW" }, orderBy: { updatedAt: "asc" }, take: 25, include: { productLinks: { where: { approvedAt: { not: null } }, orderBy: { productTitle: "asc" }, select: { productTitle: true, productHandle: true } }, reviewItems: { where: { status: "AWAITING_REVIEW", kind: "LINK_EXISTING" }, select: { id: true } } } });
      cards = rows.map((card) => { const legacy = normalizeLegacyCommerce(card.payload); return { id: card.id, commonName: card.commonName, scientificName: card.scientificName, mode: card.commerceMode === "UNREVIEWED" ? legacy.mode : card.commerceMode, searchQuery: card.commerceSearchQuery || legacy.searchQuery || "", shopUrl: card.commerceShopUrl || legacy.shopUrl, pendingLinkCount: card.reviewItems.length, links: card.productLinks.map((link) => ({ title: link.productTitle, handle: link.productHandle })) }; });
    }
  } catch (error) { console.warn("Species commerce review is waiting for its migration:", error); }
  return <section className="species-panel"><div className="species-panel-heading"><div><p className="page-header-eyebrow">Card button behavior</p><h3>Commerce review</h3></div><span className="species-status-pill">{pending} waiting</span></div><p className="page-description">One linked product recommends a direct product button. Multiple linked products require an approved storefront search phrase. Every link change reopens this decision.</p><SpeciesCommerceReview cards={cards} />{pending > cards.length && <p className="species-commerce-more">Showing the oldest {cards.length} of {pending} decisions.</p>}</section>;
}
