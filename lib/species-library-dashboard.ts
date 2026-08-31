import { assertSpeciesLibraryShop, SPECIES_SCHEMA_VERSION } from "./species-library";

export type SpeciesDashboardData = {
  configured: boolean;
  databaseReady: boolean;
  approvedCards: number;
  awaitingReview: number;
  publishedCards: number;
  schemaVersion: number;
  recentItems: Array<{
    id: string;
    productTitle: string;
    kind: string;
    status: string;
    textStatus: string;
    imageStatus: string;
    matchConfidence: number | null;
    draftPayload: unknown;
    candidateCard: { commonName: string; scientificName: string } | null;
  }>;
};

const emptyData: SpeciesDashboardData = {
  configured: false,
  databaseReady: false,
  approvedCards: 0,
  awaitingReview: 0,
  publishedCards: 0,
  schemaVersion: SPECIES_SCHEMA_VERSION,
  recentItems: [],
};

export async function getSpeciesDashboardData(): Promise<SpeciesDashboardData> {
  if (!process.env.SPECIES_LIBRARY_SHOP_DOMAIN || !process.env.DATABASE_URL) return emptyData;

  try {
    const shop = assertSpeciesLibraryShop();
    const { prisma } = await import("./prisma");
    const [approvedCards, awaitingReview, publishedCards, recentItems] = await Promise.all([
      prisma.speciesLibraryCard.count({ where: { shop, status: { startsWith: "APPROVED" } } }),
      prisma.speciesReviewItem.count({ where: { shop, status: "AWAITING_REVIEW" } }),
      prisma.speciesLibraryCard.count({ where: { shop, status: "PUBLISHED" } }),
      prisma.speciesReviewItem.findMany({
        where: { shop, status: "AWAITING_REVIEW" }, orderBy: { updatedAt: "asc" }, take: 25,
        select: {
          id: true, productTitle: true, kind: true, status: true,
          textStatus: true, imageStatus: true, matchConfidence: true,
          draftPayload: true,
          candidateCard: { select: { commonName: true, scientificName: true } },
        },
      }),
    ]);
    return {
      configured: true, databaseReady: true, approvedCards,
      awaitingReview, publishedCards, schemaVersion: SPECIES_SCHEMA_VERSION,
      recentItems,
    };
  } catch (error) {
    console.warn("Species Library dashboard is waiting for database setup:", error);
    return { ...emptyData, configured: true };
  }
}
