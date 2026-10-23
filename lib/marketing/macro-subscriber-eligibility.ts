import type { Prisma } from "@/app/generated/prisma/client";
import type { Tx } from "./store";
import { currentMarketingBrand, marketingShop } from "./context";

export const macroSubscriberList = "Shopify email subscribers";

/** Imported list names alone are never proof of permission for this store. */
export function macroShopifySubscribed(properties: unknown, now = new Date()) {
  const proof = (properties as { shopifyEmailConsent?: { state?: unknown; checkedAt?: unknown } } | null)?.shopifyEmailConsent;
  return proof?.state === "SUBSCRIBED" && typeof proof.checkedAt === "string" &&
    Number.isFinite(Date.parse(proof.checkedAt)) && Date.parse(proof.checkedAt) <= +now;
}

export function macroShopifySubscriberWhere(now = new Date()): Prisma.MarketingProfileWhereInput {
  return { AND: [
    { properties: { path: ["shopifyEmailConsent", "state"], equals: "SUBSCRIBED" } },
    { properties: { path: ["shopifyEmailConsent", "checkedAt"], gte: "1970-01-01T00:00:00.000Z", lte: now.toISOString() } },
  ] };
}

export async function macroConsentObservationCurrent(tx: Tx, profileId: string, occurredAt: Date) {
  if (currentMarketingBrand() !== "macroalgae-farms") return true;
  const profile = await tx.marketingProfile.findFirst({ where: { id: profileId, shop: marketingShop() }, select: { properties: true } });
  const previous = (profile?.properties as { shopifyEmailConsent?: { occurredAt?: string } } | null)?.shopifyEmailConsent;
  return !previous?.occurredAt || !(Date.parse(previous.occurredAt) > +occurredAt);
}

/** A remote page is a snapshot; a newer local webhook may have arrived during its lookup. */
export function macroShopifySnapshotCurrent(properties: unknown, occurredAt: Date, lookupStartedAt: Date) {
  const proof = (properties as { shopifyEmailConsent?: { occurredAt?: string; checkedAt?: string } } | null)?.shopifyEmailConsent;
  if (!proof?.checkedAt || !(Date.parse(proof.checkedAt) > +lookupStartedAt)) return true;
  const previousAt = Date.parse(proof.occurredAt || proof.checkedAt);
  return Number.isFinite(previousAt) && Number.isFinite(+occurredAt) && +occurredAt > previousAt;
}

/** Only authenticated store observations may update the source proof, never a list import. */
export async function applyMacroShopifyConsent(
  tx: Tx,
  profileId: string,
  state: string,
  occurredAt: Date,
  options: { authoritative?: boolean; checkedAt?: Date; lookupStartedAt?: Date } = {},
) {
  if (currentMarketingBrand() !== "macroalgae-farms") return false;
  const checkedAt = options.checkedAt || new Date();
  if (!Number.isFinite(+occurredAt) || occurredAt > checkedAt) throw Error("Shopify consent observation has an invalid date.");
  const profile = await tx.marketingProfile.findFirst({ where: { id: profileId, shop: marketingShop() }, include: {
    consents: { where: { channel: "EMAIL" } },
  } });
  if (!profile) throw Error("Macroalgae Farms contact was not found.");
  const previous = (profile.properties as { shopifyEmailConsent?: { occurredAt?: string } } | null)?.shopifyEmailConsent;
  if (options.authoritative && (!options.lookupStartedAt ||
      !macroShopifySnapshotCurrent(profile.properties, occurredAt, options.lookupStartedAt))) return false;
  if (!options.authoritative && previous?.occurredAt && Date.parse(previous.occurredAt) > +occurredAt) return false;
  const consent = profile.consents[0];
  const eligible = state === "SUBSCRIBED" && consent?.status === "SUBSCRIBED" && !consent.suppressed;
  await tx.marketingProfile.update({ where: { id: profile.id }, data: {
    lists: eligible ? [...new Set([...profile.lists, macroSubscriberList])] : profile.lists.filter(list => list !== macroSubscriberList),
    properties: { ...(profile.properties as object), shopifyEmailConsent: {
      state, occurredAt: occurredAt.toISOString(), checkedAt: checkedAt.toISOString(),
    } },
  } });
  return eligible;
}
