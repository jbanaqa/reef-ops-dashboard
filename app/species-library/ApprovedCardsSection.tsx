import { assertSpeciesLibraryShop } from "@/lib/species-library";
import { ApprovedCardEditor, type ApprovedCardOption } from "./ApprovedCardEditor";

export async function ApprovedCardsSection() {
  let cards: ApprovedCardOption[] = [];
  try {
    if (process.env.DATABASE_URL && process.env.SPECIES_LIBRARY_SHOP_DOMAIN) {
      const shop = assertSpeciesLibraryShop();
      const { prisma } = await import("@/lib/prisma");
      cards = await prisma.speciesLibraryCard.findMany({
        where: { shop, status: { startsWith: "APPROVED" } },
        orderBy: [{ commonName: "asc" }, { scientificName: "asc" }],
        select: { id: true, speciesKey: true, commonName: true, scientificName: true },
      });
    }
  } catch (error) { console.warn("Approved species cards are waiting for database setup:", error); }
  return <section className="species-panel">
    <div className="species-panel-heading"><div><p className="page-header-eyebrow">Versioned library</p><h3>Edit approved card</h3></div><span className="species-status-pill">{cards.length} cards</span></div>
    <p className="page-description">Edit an existing card without changing its identity or product mappings. Saving creates a new version; the storefront changes only after an explicit Shopify publication.</p>
    <ApprovedCardEditor cards={cards} />
  </section>;
}
