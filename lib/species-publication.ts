import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { assertSpeciesLibraryShop } from "./species-library";
import { macroalgaeGraphql } from "./macroalgae-shopify";

const SHOP_METAFIELD_NAMESPACE = "reef_ops";
const SHOP_METAFIELD_KEY = "species_library";

type ShopResponse = { data?: { shop?: { id: string } } };
type MetafieldsSetResponse = { data?: { metafieldsSet?: { metafields?: Array<{ id: string; namespace: string; key: string; updatedAt: string }>; userErrors?: Array<{ field?: string[]; message: string; code?: string }> } } };

export class SpeciesPublicationError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}

async function canonicalSpeciesKeys() {
  const sourcePath = path.resolve(process.cwd(), "data/species-library.json");
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8")) as Array<{ id?: unknown }>;
  if (!Array.isArray(source)) throw new SpeciesPublicationError("Canonical Species Library data is not an array.", 500);
  const keys = source.map((card) => String(card?.id || "").trim());
  const duplicates = keys.filter((key, index) => key && keys.indexOf(key) !== index);
  if (keys.some((key) => !key) || duplicates.length) throw new SpeciesPublicationError("Canonical Species Library IDs are missing or duplicated.", 500, [...new Set(duplicates)]);
  return keys;
}

function publicationIntegrity<T extends { speciesKey: string; payload: unknown }>(cards: T[], canonicalKeys: string[]) {
  const canonicalSet = new Set(canonicalKeys);
  const databaseKeys = new Set(cards.map((card) => card.speciesKey));
  const missingCanonical = canonicalKeys.filter((key) => !databaseKeys.has(key));
  const mismatchedIds = cards.filter((card) => {
    const payload = card.payload && typeof card.payload === "object" && !Array.isArray(card.payload) ? card.payload as Record<string, unknown> : {};
    return String(payload.id || "") !== card.speciesKey;
  }).map((card) => card.speciesKey);
  const order = new Map(canonicalKeys.map((key, index) => [key, index]));
  const ordered = [...cards].sort((a, b) => {
    const aOrder = order.get(a.speciesKey);
    const bOrder = order.get(b.speciesKey);
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    return a.speciesKey.localeCompare(b.speciesKey);
  });
  return { canonicalSet, missingCanonical, mismatchedIds, ordered, newCards: cards.filter((card) => !canonicalSet.has(card.speciesKey)).length };
}

export async function getSpeciesPublicationReadiness() {
  const shop = assertSpeciesLibraryShop();
  const [cards, pendingCommerce, canonicalKeys] = await Promise.all([
    prisma.speciesLibraryCard.findMany({ where: { shop, status: { startsWith: "APPROVED" } }, select: { speciesKey: true, payload: true } }),
    prisma.speciesLibraryCard.count({ where: { shop, commerceReviewStatus: "NEEDS_REVIEW" } }),
    canonicalSpeciesKeys(),
  ]);
  const integrity = publicationIntegrity(cards, canonicalKeys);
  const latest = await prisma.speciesLibraryCard.findFirst({ where: { shop, publishedVersionId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  const blockReason = integrity.missingCanonical.length ? `${integrity.missingCanonical.length} existing card${integrity.missingCanonical.length === 1 ? " is" : "s are"} missing from the database.` : integrity.mismatchedIds.length ? `${integrity.mismatchedIds.length} card ID mismatch${integrity.mismatchedIds.length === 1 ? "" : "es"} must be corrected.` : null;
  return { cards: cards.length, canonicalCards: canonicalKeys.length, newCards: integrity.newCards, pendingCommerce, blockReason, lastPublishedAt: latest?.updatedAt.toISOString() || null, ready: cards.length >= canonicalKeys.length && pendingCommerce === 0 && !blockReason };
}

export async function publishSpeciesLibrary(reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  const databaseCards = await prisma.speciesLibraryCard.findMany({
    where: { shop, status: { startsWith: "APPROVED" } },
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } } },
  });
  const canonicalKeys = await canonicalSpeciesKeys();
  const integrity = publicationIntegrity(databaseCards, canonicalKeys);
  if (integrity.missingCanonical.length) throw new SpeciesPublicationError("Publication refused because existing library cards are missing.", 409, integrity.missingCanonical);
  if (integrity.mismatchedIds.length) throw new SpeciesPublicationError("Publication refused because card IDs do not match their database keys.", 409, integrity.mismatchedIds);
  const cards = integrity.ordered;
  if (!cards.length) throw new SpeciesPublicationError("No approved species cards are available to publish.");
  const pending = cards.filter((card) => card.commerceReviewStatus === "NEEDS_REVIEW");
  if (pending.length) throw new SpeciesPublicationError(`Resolve commerce review for ${pending.length} card${pending.length === 1 ? "" : "s"} before publishing.`, 409);
  const missingVersions = cards.filter((card) => !card.versions[0]);
  if (missingVersions.length) throw new SpeciesPublicationError("Every card must have a version before publication.", 409, missingVersions.map((card) => card.speciesKey));

  const value = JSON.stringify(cards.map((card) => card.payload));
  if (Buffer.byteLength(value, "utf8") > 2_000_000) throw new SpeciesPublicationError("Species Library snapshot exceeds Shopify's safe JSON metafield size.", 413);
  const shopResponse = await macroalgaeGraphql<ShopResponse>(`query SpeciesPublicationShop { shop { id } }`);
  const ownerId = shopResponse.data?.shop?.id;
  if (!ownerId) throw new SpeciesPublicationError("Shopify did not return the Macroalgae Farms shop ID.", 502);
  const response = await macroalgaeGraphql<MetafieldsSetResponse>(`mutation PublishSpeciesLibrary($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id namespace key updatedAt } userErrors { field message code } } }`, {
    metafields: [{ ownerId, namespace: SHOP_METAFIELD_NAMESPACE, key: SHOP_METAFIELD_KEY, type: "json", value }],
  });
  const result = response.data?.metafieldsSet;
  if (!result) throw new SpeciesPublicationError("Shopify returned no metafield publication result.", 502);
  if (result.userErrors?.length) throw new SpeciesPublicationError("Shopify rejected the Species Library publication.", 422, result.userErrors);
  const publishedAt = new Date();
  await prisma.$transaction(async (tx) => {
    for (const card of cards) await tx.speciesLibraryCard.update({ where: { id: card.id }, data: { publishedVersionId: card.versions[0].id } });
    await tx.speciesReviewItem.updateMany({ where: { shop, candidateCardId: { in: cards.map((card) => card.id) }, status: "APPROVED" }, data: { publicationStatus: "PUBLISHED", publishedAt, reviewedBy: reviewer } });
  });
  return { shop, cards: cards.length, canonicalCards: canonicalKeys.length, newCards: integrity.newCards, bytes: Buffer.byteLength(value, "utf8"), publishedAt: publishedAt.toISOString(), metafield: result.metafields?.[0] || null };
}
