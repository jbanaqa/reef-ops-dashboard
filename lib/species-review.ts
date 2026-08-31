import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { assertSpeciesLibraryShop, SPECIES_SCHEMA_VERSION, type SpeciesCardPayload, validateSpeciesCard } from "./species-library";

export type ReviewAction = "REJECT" | "SAVE_DRAFT" | "APPROVE_LINK" | "APPROVE_CARD" | "REASSIGN_LINK";
export type ReviewInput = { action: ReviewAction; notes?: string; payload?: unknown; candidateCardId?: string };

export class SpeciesReviewError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}

export async function reviewSpeciesItem(id: string, input: ReviewInput, reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  const item = await prisma.speciesReviewItem.findFirst({ where: { id, shop } });
  if (!item) throw new SpeciesReviewError("Review item not found.", 404);
  if (item.status !== "AWAITING_REVIEW" && input.action !== "SAVE_DRAFT") {
    throw new SpeciesReviewError(`Review item is already ${item.status.toLowerCase()}.`, 409);
  }

  if (input.action === "REASSIGN_LINK") {
    if (!input.candidateCardId) throw new SpeciesReviewError("Choose an approved card first.");
    const candidate = await prisma.speciesLibraryCard.findFirst({ where: { id: input.candidateCardId, shop, status: { startsWith: "APPROVED" } }, select: { id: true } });
    if (!candidate) throw new SpeciesReviewError("Selected card is not available for this store.", 404);
    return prisma.speciesReviewItem.update({
      where: { id }, data: {
        kind: "LINK_EXISTING", candidateCardId: candidate.id, matchConfidence: null,
        matchReasons: ["Manually reassigned by dashboard reviewer"],
        reviewNotes: input.notes || item.reviewNotes,
      },
    });
  }

  if (input.action === "REJECT") {
    return prisma.speciesReviewItem.update({
      where: { id }, data: { status: "REJECTED", reviewNotes: input.notes || null, reviewedBy: reviewer, reviewedAt: new Date() },
    });
  }

  if (input.action === "SAVE_DRAFT") {
    if (!input.payload || typeof input.payload !== "object") throw new SpeciesReviewError("Draft payload must be a JSON object.");
    const validation = validateSpeciesCard(input.payload);
    return prisma.speciesReviewItem.update({
      where: { id }, data: {
        draftPayload: input.payload as Prisma.InputJsonValue,
        textStatus: validation.valid ? "READY" : "FAILED",
        lastError: validation.valid ? null : validation.errors.join("; "),
        reviewNotes: input.notes || item.reviewNotes,
      },
    });
  }

  if (input.action === "APPROVE_LINK") {
    if (!item.candidateCardId) throw new SpeciesReviewError("This proposal has no candidate card.");
    return prisma.$transaction(async (tx) => {
      await tx.speciesProductLink.upsert({
        where: { shop_shopifyProductId: { shop, shopifyProductId: item.shopifyProductId } },
        create: {
          shop, shopifyProductId: item.shopifyProductId, productTitle: item.productTitle,
          productHandle: item.productHandle, cardId: item.candidateCardId!,
          matchMethod: "HUMAN_APPROVED", confidence: item.matchConfidence, approvedAt: new Date(),
        },
        update: {
          productTitle: item.productTitle, productHandle: item.productHandle,
          cardId: item.candidateCardId!, matchMethod: "HUMAN_APPROVED",
          confidence: item.matchConfidence, approvedAt: new Date(),
        },
      });
      return tx.speciesReviewItem.update({
        where: { id }, data: { status: "APPROVED", reviewedBy: reviewer, reviewedAt: new Date(), approvedAt: new Date(), reviewNotes: input.notes || null },
      });
    });
  }

  const payload = (input.payload || item.draftPayload) as SpeciesCardPayload | null;
  const validation = validateSpeciesCard(payload);
  if (!validation.valid || !payload) throw new SpeciesReviewError("Card draft is not valid.", 422, validation.errors);
  const duplicate = await prisma.speciesLibraryCard.findUnique({ where: { shop_speciesKey: { shop, speciesKey: payload.id } } });
  if (duplicate) throw new SpeciesReviewError("That species ID already exists. Approve a link to the existing card instead.", 409);

  return prisma.$transaction(async (tx) => {
    const card = await tx.speciesLibraryCard.create({
      data: {
        shop, speciesKey: payload.id, group: payload.group, commonName: payload.commonName,
        scientificName: payload.scientificName, schemaVersion: SPECIES_SCHEMA_VERSION,
        payload: payload as Prisma.InputJsonValue, status: "APPROVED",
      },
    });
    await tx.speciesCardVersion.create({
      data: { cardId: card.id, version: 1, payload: payload as Prisma.InputJsonValue, imageUrl: payload.img, source: "HUMAN_EDIT", createdBy: reviewer },
    });
    await tx.speciesProductLink.create({
      data: {
        shop, shopifyProductId: item.shopifyProductId, productTitle: item.productTitle,
        productHandle: item.productHandle, cardId: card.id,
        matchMethod: "HUMAN_CREATED", confidence: 1, approvedAt: new Date(),
      },
    });
    return tx.speciesReviewItem.update({
      where: { id }, data: {
        status: "APPROVED", candidateCardId: card.id, draftPayload: payload as Prisma.InputJsonValue,
        textStatus: "READY", reviewedBy: reviewer, reviewedAt: new Date(), approvedAt: new Date(), reviewNotes: input.notes || null,
      },
    });
  });
}

export async function approveHighConfidenceLinks(itemIds: string[], reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  const uniqueIds = [...new Set(itemIds)];
  if (!uniqueIds.length || uniqueIds.length > 50) throw new SpeciesReviewError("Select between 1 and 50 queue items.");
  const items = await prisma.speciesReviewItem.findMany({ where: { id: { in: uniqueIds }, shop } });
  if (items.length !== uniqueIds.length) throw new SpeciesReviewError("One or more queue items were not found.", 404);
  const unsafe = items.filter((item) => item.status !== "AWAITING_REVIEW" || item.kind !== "LINK_EXISTING" || !item.candidateCardId || (item.matchConfidence || 0) < 0.95);
  if (unsafe.length) throw new SpeciesReviewError("Batch approval only accepts awaiting-review existing-card links at 95% confidence or higher.", 409);

  return prisma.$transaction(async (tx) => {
    const approvedAt = new Date();
    for (const item of items) {
      await tx.speciesProductLink.upsert({
        where: { shop_shopifyProductId: { shop, shopifyProductId: item.shopifyProductId } },
        create: {
          shop, shopifyProductId: item.shopifyProductId, productTitle: item.productTitle,
          productHandle: item.productHandle, cardId: item.candidateCardId!, matchMethod: "HUMAN_BATCH_APPROVED",
          confidence: item.matchConfidence, approvedAt,
        },
        update: {
          productTitle: item.productTitle, productHandle: item.productHandle,
          cardId: item.candidateCardId!, matchMethod: "HUMAN_BATCH_APPROVED",
          confidence: item.matchConfidence, approvedAt,
        },
      });
      await tx.speciesReviewItem.update({
        where: { id: item.id }, data: { status: "APPROVED", reviewedBy: reviewer, reviewedAt: approvedAt, approvedAt, reviewNotes: "Explicit high-confidence batch approval" },
      });
    }
    return { approved: items.length };
  });
}
