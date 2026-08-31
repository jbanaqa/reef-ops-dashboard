import type { Prisma } from "@/app/generated/prisma/client";
import type { SpeciesProductSnapshot } from "./macroalgae-shopify";
import { prisma } from "./prisma";
import { assertSpeciesLibraryShop, createProductFingerprint } from "./species-library";
import { matchProductToSpecies } from "./species-library-matcher";

export async function processSpeciesProduct(product: SpeciesProductSnapshot) {
  const shop = assertSpeciesLibraryShop();
  if (!new Set(["ACTIVE", "DRAFT"]).has(product.status.toUpperCase())) {
    return { action: "ignored_status", productId: product.id, status: product.status } as const;
  }

  const existingLink = await prisma.speciesProductLink.findUnique({
    where: { shop_shopifyProductId: { shop, shopifyProductId: product.id } },
    select: { id: true, cardId: true },
  });
  if (existingLink) return { action: "already_linked", productId: product.id, cardId: existingLink.cardId } as const;

  const cards = await prisma.speciesLibraryCard.findMany({
    where: { shop, status: { startsWith: "APPROVED" } },
    select: { id: true, speciesKey: true, commonName: true, scientificName: true, payload: true },
  });
  const match = matchProductToSpecies(product, cards);
  const updatedAt = new Date(product.updatedAt);
  const fingerprint = createProductFingerprint({
    productId: product.id, title: product.title, handle: product.handle,
    status: product.status, description: product.descriptionHtml,
    imageUrls: product.imageUrls, updatedAt,
  });

  const existing = await prisma.speciesReviewItem.findUnique({
    where: { shop_shopifyProductId_sourceFingerprint: {
      shop, shopifyProductId: product.id, sourceFingerprint: fingerprint,
    } },
    select: { id: true },
  });
  if (existing) return { action: "duplicate_ignored", productId: product.id, reviewItemId: existing.id } as const;

  const item = await prisma.speciesReviewItem.create({
    data: {
      shop, shopifyProductId: product.id, productTitle: product.title,
      productHandle: product.handle, productStatus: product.status,
      productDescription: product.descriptionHtml,
      productImageUrls: product.imageUrls as Prisma.InputJsonValue,
      productUpdatedAt: updatedAt, sourceFingerprint: fingerprint,
      kind: match ? "LINK_EXISTING" : "CREATE_CARD",
      status: "AWAITING_REVIEW", candidateCardId: match?.cardId,
      matchConfidence: match?.confidence,
      matchReasons: match?.reasons as Prisma.InputJsonValue | undefined,
    },
    select: { id: true, kind: true },
  });
  return {
    action: "queued", productId: product.id, reviewItemId: item.id,
    kind: item.kind, candidateSpeciesKey: match?.speciesKey || null,
    confidence: match?.confidence || null,
  } as const;
}
