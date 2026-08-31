import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { fetchSpeciesProducts } from "./macroalgae-shopify";
import { assertSpeciesLibraryShop, createProductFingerprint } from "./species-library";
import { matchProductToSpecies } from "./species-library-matcher";

const OVERLAP_MS = 5 * 60 * 1000;

export async function reconcileSpeciesProducts() {
  const shop = assertSpeciesLibraryShop();
  const startedAt = new Date();
  await prisma.speciesSyncCheckpoint.upsert({
    where: { shop }, create: { shop, lastStatus: "RUNNING", lastCheckedAt: startedAt },
    update: { lastStatus: "RUNNING", lastError: null, lastCheckedAt: startedAt },
  });

  try {
    const checkpoint = await prisma.speciesSyncCheckpoint.findUnique({ where: { shop } });
    const updatedAfter = checkpoint?.lastProductUpdatedAt
      ? new Date(checkpoint.lastProductUpdatedAt.getTime() - OVERLAP_MS)
      : null;
    const [products, cards, links] = await Promise.all([
      fetchSpeciesProducts(updatedAfter),
      prisma.speciesLibraryCard.findMany({
        where: { shop, status: { startsWith: "APPROVED" } },
        select: { id: true, speciesKey: true, commonName: true, scientificName: true, payload: true },
      }),
      prisma.speciesProductLink.findMany({ where: { shop }, select: { shopifyProductId: true } }),
    ]);
    const linked = new Set(links.map((link) => link.shopifyProductId));
    let queued = 0;
    let linkedSkipped = 0;
    let matched = 0;
    let newCardCandidates = 0;
    let newestUpdate = checkpoint?.lastProductUpdatedAt || null;

    for (const product of products) {
      const updatedAt = new Date(product.updatedAt);
      if (!newestUpdate || updatedAt > newestUpdate) newestUpdate = updatedAt;
      if (linked.has(product.id)) { linkedSkipped += 1; continue; }

      const match = matchProductToSpecies(product, cards);
      const fingerprint = createProductFingerprint({
        productId: product.id, title: product.title, handle: product.handle,
        status: product.status, description: product.descriptionHtml,
        imageUrls: product.imageUrls, updatedAt,
      });
      const kind = match ? "LINK_EXISTING" : "CREATE_CARD";
      const result = await prisma.speciesReviewItem.upsert({
        where: { shop_shopifyProductId_sourceFingerprint: {
          shop, shopifyProductId: product.id, sourceFingerprint: fingerprint,
        } },
        create: {
          shop, shopifyProductId: product.id, productTitle: product.title,
          productHandle: product.handle, productStatus: product.status,
          productDescription: product.descriptionHtml,
          productImageUrls: product.imageUrls as Prisma.InputJsonValue,
          productUpdatedAt: updatedAt, sourceFingerprint: fingerprint,
          kind, status: "AWAITING_REVIEW", candidateCardId: match?.cardId,
          matchConfidence: match?.confidence,
          matchReasons: match?.reasons as Prisma.InputJsonValue | undefined,
        },
        update: {}, select: { createdAt: true, updatedAt: true },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) queued += 1;
      if (match) matched += 1; else newCardCandidates += 1;
    }

    await prisma.speciesSyncCheckpoint.update({
      where: { shop }, data: {
        lastStatus: "COMPLETED", lastCompletedAt: new Date(),
        lastProductUpdatedAt: newestUpdate,
      },
    });
    return { shop, scanned: products.length, queued, matched, newCardCandidates, linkedSkipped, updatedAfter };
  } catch (error) {
    await prisma.speciesSyncCheckpoint.update({
      where: { shop }, data: { lastStatus: "FAILED", lastError: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}
