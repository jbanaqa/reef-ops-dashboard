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

export async function getSpeciesPublicationReadiness() {
  const shop = assertSpeciesLibraryShop();
  const [cards, pendingCommerce] = await Promise.all([
    prisma.speciesLibraryCard.count({ where: { shop, status: { startsWith: "APPROVED" } } }),
    prisma.speciesLibraryCard.count({ where: { shop, commerceReviewStatus: "NEEDS_REVIEW" } }),
  ]);
  const latest = await prisma.speciesLibraryCard.findFirst({ where: { shop, publishedVersionId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  return { cards, pendingCommerce, lastPublishedAt: latest?.updatedAt.toISOString() || null, ready: cards > 0 && pendingCommerce === 0 };
}

export async function publishSpeciesLibrary(reviewer: string) {
  const shop = assertSpeciesLibraryShop();
  const cards = await prisma.speciesLibraryCard.findMany({
    where: { shop, status: { startsWith: "APPROVED" } },
    orderBy: { speciesKey: "asc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } } },
  });
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
  return { shop, cards: cards.length, bytes: Buffer.byteLength(value, "utf8"), publishedAt: publishedAt.toISOString(), metafield: result.metafields?.[0] || null };
}
