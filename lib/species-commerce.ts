import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { assertSpeciesLibraryShop } from "./species-library";

export const COMMERCE_MODES = ["DIRECT", "SEARCH", "UNAVAILABLE"] as const;
export type SpeciesCommerceMode = (typeof COMMERCE_MODES)[number];

export type SpeciesCommerceConfig = {
  mode: SpeciesCommerceMode;
  productHandle: string | null;
  searchQuery: string | null;
  shopUrl: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function storefrontOrigin(value?: string | null) {
  try { return new URL(value || "").origin; } catch { return "https://www.macroalgaefarms.com"; }
}

export function normalizeLegacyCommerce(payload: unknown): SpeciesCommerceConfig {
  const card = record(payload);
  const explicit = record(card.commerce);
  const legacyUrl = String(explicit.shopUrl || card.shopUrl || "").trim();
  const explicitMode = String(explicit.mode || "").toUpperCase();
  let url: URL | null = null;
  try { url = new URL(legacyUrl); } catch { /* Legacy cards may use # or an empty URL. */ }

  const path = url?.pathname || "";
  const productMatch = path.match(/^\/products\/([^/]+)/i);
  const mode: SpeciesCommerceMode = COMMERCE_MODES.includes(explicitMode as SpeciesCommerceMode)
    ? explicitMode as SpeciesCommerceMode
    : productMatch ? "DIRECT" : path === "/search" ? "SEARCH" : "UNAVAILABLE";
  const productHandle = String(explicit.productHandle || (productMatch ? decodeURIComponent(productMatch[1]) : "")).trim() || null;
  const searchQuery = String(explicit.searchQuery || url?.searchParams.get("q") || "").trim() || null;
  return { mode, productHandle, searchQuery, shopUrl: legacyUrl };
}

export function buildCommerceConfig(input: { mode: SpeciesCommerceMode; productHandle?: string | null; searchQuery?: string | null; currentUrl?: string | null }): SpeciesCommerceConfig {
  const origin = storefrontOrigin(input.currentUrl);
  if (input.mode === "DIRECT") {
    const handle = String(input.productHandle || "").trim();
    if (!handle) throw new Error("Choose the single linked product for a direct button.");
    return { mode: "DIRECT", productHandle: handle, searchQuery: null, shopUrl: `${origin}/products/${encodeURIComponent(handle)}` };
  }
  if (input.mode === "SEARCH") {
    const query = String(input.searchQuery || "").trim();
    if (!query) throw new Error("Enter a search phrase for a multi-product card.");
    return { mode: "SEARCH", productHandle: null, searchQuery: query, shopUrl: `${origin}/search?q=${encodeURIComponent(query)}&type=product` };
  }
  return { mode: "UNAVAILABLE", productHandle: null, searchQuery: null, shopUrl: "#" };
}

export function applyCommerceToPayload(payload: unknown, commerce: SpeciesCommerceConfig) {
  const next = { ...record(payload) };
  next.commerce = { mode: commerce.mode.toLowerCase(), productHandle: commerce.productHandle, searchQuery: commerce.searchQuery, shopUrl: commerce.shopUrl };
  next.shopType = commerce.mode === "SEARCH" ? "search" : commerce.mode === "DIRECT" ? "direct" : "unavailable";
  next.shopUrl = commerce.shopUrl;
  return next;
}

type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export async function markCommerceReviewRequired(tx: TransactionClient, cardIds: string[]) {
  if (!cardIds.length) return;
  await tx.speciesLibraryCard.updateMany({
    where: { id: { in: [...new Set(cardIds)] } },
    data: { commerceReviewStatus: "NEEDS_REVIEW", commerceReviewedAt: null, commerceReviewedBy: null },
  });
}

export async function reviewSpeciesCommerce(cardId: string, input: { mode: SpeciesCommerceMode; productHandle?: string | null; searchQuery?: string | null }, reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  if (!COMMERCE_MODES.includes(input.mode)) throw new Error("Invalid commerce mode.");
  return (await import("./prisma")).prisma.$transaction(async (tx) => {
    const card = await tx.speciesLibraryCard.findFirst({ where: { id: cardId, shop }, include: { productLinks: { where: { approvedAt: { not: null } }, select: { productHandle: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } } });
    if (!card) throw new Error("Species card not found.");
    const handles = card.productLinks.map((link) => link.productHandle).filter((handle): handle is string => Boolean(handle));
    if (input.mode === "DIRECT" && (handles.length !== 1 || input.productHandle !== handles[0])) throw new Error("Direct mode requires exactly one approved linked product.");
    if (input.mode === "UNAVAILABLE" && handles.length) throw new Error("Unavailable mode is only allowed when no approved products are linked.");
    const legacy = normalizeLegacyCommerce(card.payload);
    const commerce = buildCommerceConfig({ ...input, currentUrl: card.commerceShopUrl || legacy.shopUrl });
    const payload = applyCommerceToPayload(card.payload, commerce) as Prisma.InputJsonValue;
    const now = new Date();
    const updated = await tx.speciesLibraryCard.update({ where: { id: card.id }, data: { payload, commerceMode: commerce.mode, commerceProductHandle: commerce.productHandle, commerceSearchQuery: commerce.searchQuery, commerceShopUrl: commerce.shopUrl, commerceReviewStatus: "APPROVED", commerceReviewedAt: now, commerceReviewedBy: reviewer } });
    await tx.speciesCardVersion.create({ data: { cardId: card.id, version: (card.versions[0]?.version || 0) + 1, payload, imageUrl: record(payload).img as string | undefined, source: "COMMERCE_REVIEW", createdBy: reviewer } });
    return updated;
  });
}

export async function returnSpeciesCommerceLinksToReview(cardId: string) {
  const shop = assertSpeciesLibraryShop();
  return (await import("./prisma")).prisma.$transaction(async (tx) => {
    const card = await tx.speciesLibraryCard.findFirst({ where: { id: cardId, shop }, select: { id: true } });
    if (!card) throw new Error("Species card not found.");
    const links = await tx.speciesProductLink.findMany({ where: { shop, cardId }, select: { shopifyProductId: true } });
    const productIds = links.map((link) => link.shopifyProductId);
    if (productIds.length) {
      await tx.speciesProductLink.deleteMany({ where: { shop, cardId, shopifyProductId: { in: productIds } } });
      await tx.speciesReviewItem.updateMany({
        where: { shop, candidateCardId: cardId, shopifyProductId: { in: productIds } },
        data: { kind: "LINK_EXISTING", status: "AWAITING_REVIEW", publicationStatus: "NOT_STARTED", reviewedAt: null, approvedAt: null, publishedAt: null },
      });
    }
    await tx.speciesLibraryCard.update({
      where: { id: cardId },
      data: { commerceReviewStatus: "NEEDS_REVIEW", commerceReviewedAt: null, commerceReviewedBy: null },
    });
    return { returnedLinks: productIds.length };
  });
}
