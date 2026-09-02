import type { Prisma } from "@/app/generated/prisma/client";
import { applyCommerceToPayload, normalizeLegacyCommerce } from "./species-commerce";
import { assertSpeciesLibraryShop, SPECIES_SCHEMA_VERSION, validateSpeciesCard, type SpeciesCardPayload } from "./species-library";
import { prisma } from "./prisma";

export class SpeciesCardEditorError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}

export async function getApprovedSpeciesCard(cardId: string) {
  const shop = assertSpeciesLibraryShop();
  const card = await prisma.speciesLibraryCard.findFirst({
    where: { id: cardId, shop, status: { startsWith: "APPROVED" } },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, createdAt: true, source: true, createdBy: true } },
      _count: { select: { productLinks: true } },
    },
  });
  if (!card) throw new SpeciesCardEditorError("Approved species card not found.", 404);
  return {
    id: card.id, speciesKey: card.speciesKey, commonName: card.commonName, scientificName: card.scientificName,
    group: card.group, payload: card.payload, productLinkCount: card._count.productLinks,
    latestVersion: card.versions[0]?.version || 0,
    isPublished: Boolean(card.publishedVersionId && card.publishedVersionId === card.versions[0]?.id),
    updatedAt: card.updatedAt,
  };
}

export async function updateApprovedSpeciesCard(cardId: string, submitted: unknown, reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) throw new SpeciesCardEditorError("Card payload must be a JSON object.");
  return prisma.$transaction(async (tx) => {
    const card = await tx.speciesLibraryCard.findFirst({
      where: { id: cardId, shop, status: { startsWith: "APPROVED" } },
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } },
    });
    if (!card) throw new SpeciesCardEditorError("Approved species card not found.", 404);
    const draft = submitted as SpeciesCardPayload;
    if (draft.id !== card.speciesKey) throw new SpeciesCardEditorError(`The species ID is locked to ${card.speciesKey}. Edit the existing card without changing its ID.`, 409);

    // Commerce is reviewed separately. Preserve its approved behavior even if
    // someone pastes stale shopType/shopUrl values into the JSON editor.
    const legacy = normalizeLegacyCommerce(card.payload);
    const commerce = card.commerceMode === "UNREVIEWED" ? legacy : {
      mode: card.commerceMode as "DIRECT" | "SEARCH" | "UNAVAILABLE",
      productHandle: card.commerceProductHandle,
      searchQuery: card.commerceSearchQuery,
      shopUrl: card.commerceShopUrl || legacy.shopUrl,
    };
    const payload = applyCommerceToPayload(draft, commerce) as SpeciesCardPayload;
    const validation = validateSpeciesCard(payload);
    if (!validation.valid) throw new SpeciesCardEditorError("Card changes are not valid.", 422, validation.errors);
    const storedPayload = payload as Prisma.InputJsonValue;
    const nextVersion = (card.versions[0]?.version || 0) + 1;
    const updated = await tx.speciesLibraryCard.update({
      where: { id: card.id },
      data: {
        speciesKey: card.speciesKey, commonName: payload.commonName, scientificName: payload.scientificName,
        group: payload.group, schemaVersion: SPECIES_SCHEMA_VERSION, payload: storedPayload,
      },
    });
    const version = await tx.speciesCardVersion.create({
      data: { cardId: card.id, version: nextVersion, payload: storedPayload, imageUrl: payload.img, source: "HUMAN_EDIT", createdBy: reviewer },
    });
    return { id: updated.id, speciesKey: updated.speciesKey, version: version.version, productMappingsPreserved: true };
  });
}
