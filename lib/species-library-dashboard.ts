import type { Prisma } from "@/app/generated/prisma/client";
import { assertSpeciesLibraryShop, SPECIES_SCHEMA_VERSION } from "./species-library";

export type SpeciesQueueFilters = {
  search: string;
  kind: "ALL" | "LINK_EXISTING" | "CREATE_CARD";
  confidence: "ALL" | "HIGH" | "MEDIUM" | "LOW";
  page: number;
};

export type SpeciesDashboardData = {
  configured: boolean;
  databaseReady: boolean;
  approvedCards: number;
  awaitingReview: number;
  publishedCards: number;
  schemaVersion: number;
  queueSummary: { linkExisting: number; createCard: number; highConfidence: number };
  pagination: { page: number; pageSize: number; totalPages: number; filteredCount: number };
  filters: SpeciesQueueFilters;
  candidateCards: Array<{ id: string; speciesKey: string; commonName: string; scientificName: string }>;
  recentItems: Array<{
    id: string;
    productTitle: string;
    productHandle: string | null;
    kind: string;
    status: string;
    textStatus: string;
    imageStatus: string;
    matchConfidence: number | null;
    matchReasons: unknown;
    draftPayload: unknown;
    candidateCard: { id: string; speciesKey: string; commonName: string; scientificName: string } | null;
  }>;
};

const DEFAULT_FILTERS: SpeciesQueueFilters = { search: "", kind: "ALL", confidence: "ALL", page: 1 };
const PAGE_SIZE = 25;

function emptyData(filters = DEFAULT_FILTERS): SpeciesDashboardData {
  return {
    configured: false, databaseReady: false, approvedCards: 0, awaitingReview: 0,
    publishedCards: 0, schemaVersion: SPECIES_SCHEMA_VERSION,
    queueSummary: { linkExisting: 0, createCard: 0, highConfidence: 0 },
    pagination: { page: 1, pageSize: PAGE_SIZE, totalPages: 1, filteredCount: 0 },
    filters, candidateCards: [], recentItems: [],
  };
}

export function parseSpeciesQueueFilters(input: Record<string, string | string[] | undefined>): SpeciesQueueFilters {
  const value = (key: string) => typeof input[key] === "string" ? input[key] : "";
  const rawKind = value("kind");
  const rawConfidence = value("confidence");
  const rawPage = Number.parseInt(value("page"), 10);
  return {
    search: value("search").trim().slice(0, 120),
    kind: rawKind === "LINK_EXISTING" || rawKind === "CREATE_CARD" ? rawKind : "ALL",
    confidence: rawConfidence === "HIGH" || rawConfidence === "MEDIUM" || rawConfidence === "LOW" ? rawConfidence : "ALL",
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export async function getSpeciesDashboardData(filters = DEFAULT_FILTERS): Promise<SpeciesDashboardData> {
  if (!process.env.SPECIES_LIBRARY_SHOP_DOMAIN || !process.env.DATABASE_URL) return emptyData(filters);

  try {
    const shop = assertSpeciesLibraryShop();
    const { prisma } = await import("./prisma");
    const filterParts: Prisma.SpeciesReviewItemWhereInput[] = [];
    if (filters.search) filterParts.push({ productTitle: { contains: filters.search, mode: "insensitive" } });
    if (filters.kind !== "ALL") filterParts.push({ kind: filters.kind });
    if (filters.confidence === "HIGH") filterParts.push({ matchConfidence: { gte: 0.95 } });
    if (filters.confidence === "MEDIUM") filterParts.push({ matchConfidence: { gte: 0.7, lt: 0.95 } });
    if (filters.confidence === "LOW") filterParts.push({ OR: [{ matchConfidence: { lt: 0.7 } }, { matchConfidence: null }] });
    const queueWhere: Prisma.SpeciesReviewItemWhereInput = {
      shop, status: "AWAITING_REVIEW", ...(filterParts.length ? { AND: filterParts } : {}),
    };

    const [approvedCards, awaitingReview, publishedCards, linkExisting, createCard, highConfidence, filteredCount, candidateCards] = await Promise.all([
      prisma.speciesLibraryCard.count({ where: { shop, status: { startsWith: "APPROVED" } } }),
      prisma.speciesReviewItem.count({ where: { shop, status: "AWAITING_REVIEW" } }),
      prisma.speciesLibraryCard.count({ where: { shop, status: "PUBLISHED" } }),
      prisma.speciesReviewItem.count({ where: { shop, status: "AWAITING_REVIEW", kind: "LINK_EXISTING" } }),
      prisma.speciesReviewItem.count({ where: { shop, status: "AWAITING_REVIEW", kind: "CREATE_CARD" } }),
      prisma.speciesReviewItem.count({ where: { shop, status: "AWAITING_REVIEW", kind: "LINK_EXISTING", matchConfidence: { gte: 0.95 } } }),
      prisma.speciesReviewItem.count({ where: queueWhere }),
      prisma.speciesLibraryCard.findMany({
        where: { shop, status: { startsWith: "APPROVED" } },
        orderBy: [{ commonName: "asc" }, { scientificName: "asc" }],
        select: { id: true, speciesKey: true, commonName: true, scientificName: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
    const page = Math.min(filters.page, totalPages);
    const recentItems = await prisma.speciesReviewItem.findMany({
      where: queueWhere, orderBy: [{ matchConfidence: "desc" }, { updatedAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, productTitle: true, productHandle: true, kind: true, status: true,
        textStatus: true, imageStatus: true, matchConfidence: true, matchReasons: true,
        draftPayload: true,
        candidateCard: { select: { id: true, speciesKey: true, commonName: true, scientificName: true } },
      },
    });
    return {
      configured: true, databaseReady: true, approvedCards, awaitingReview, publishedCards,
      schemaVersion: SPECIES_SCHEMA_VERSION,
      queueSummary: { linkExisting, createCard, highConfidence },
      pagination: { page, pageSize: PAGE_SIZE, totalPages, filteredCount },
      filters: { ...filters, page }, candidateCards, recentItems,
    };
  } catch (error) {
    console.warn("Species Library dashboard is waiting for database setup:", error);
    return { ...emptyData(filters), configured: true };
  }
}
