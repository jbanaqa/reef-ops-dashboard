// A source membership snapshot is separate from a customer's subscription.
// It authorizes only campaigns explicitly using this one migrated audience.
export const klaviyoMailableId = "Rr5yRa";
export type SegmentSnapshot = { id: string; batch: string; syncedAt: string; shopifyConsentCheckedAt?: string };
export function segmentSnapshot(value: unknown): SegmentSnapshot | undefined {
  if (value == null) return undefined;
  const v = value as Partial<SegmentSnapshot>;
  if (v.id !== klaviyoMailableId || typeof v.batch !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.batch) || typeof v.syncedAt !== "string" ||
      !Number.isFinite(Date.parse(v.syncedAt)))
    throw new Error("Invalid Klaviyo audience snapshot.");
  if (v.shopifyConsentCheckedAt !== undefined && (typeof v.shopifyConsentCheckedAt !== "string" ||
      !Number.isFinite(Date.parse(v.shopifyConsentCheckedAt))))
    throw new Error("Invalid Shopify audience review timestamp.");
  return { id: v.id, batch: v.batch, syncedAt: v.syncedAt,
    ...(v.shopifyConsentCheckedAt ? { shopifyConsentCheckedAt: v.shopifyConsentCheckedAt } : {}) };
}
export function inSegmentSnapshot(properties: unknown, snapshot: SegmentSnapshot) {
  const proof = (properties as { klaviyoMailable?: Record<string, unknown> } | null)?.klaviyoMailable;
  return proof?.id === snapshot.id && proof.batch === snapshot.batch &&
    proof.canReceiveMarketing === true;
}
export function snapshotConsentAllowed(consent: { status: string; suppressed: boolean } | null | undefined) {
  return !consent?.suppressed && (!consent || ["SUBSCRIBED", "NEVER_SUBSCRIBED"].includes(consent.status));
}

export function inMasterMarketingAudience(properties: unknown, snapshot: SegmentSnapshot, startedAt: string) {
  const joined = (properties as { masterMarketing?: { startedAt?: string } } | null)?.masterMarketing;
  return inSegmentSnapshot(properties, snapshot) || joined?.startedAt === startedAt;
}

/** A later Klaviyo refresh must not erase the user's Shopify consent review. */
export function refreshedSnapshotProof(properties: unknown, snapshot: SegmentSnapshot) {
  const review = (properties as { klaviyoMailable?: { shopifyConsent?: {
    source?: string; state?: string; checkedAt?: string;
  } } } | null)?.klaviyoMailable?.shopifyConsent;
  const allowed = review === undefined || (review?.source === "shopify" &&
    review.state === "SUBSCRIBED" && typeof review.checkedAt === "string" &&
    Number.isFinite(Date.parse(review.checkedAt)));
  return { ...snapshot, klaviyoCanReceiveMarketing: true, canReceiveMarketing: allowed,
    ...(review !== undefined ? { shopifyConsent: review } : {}) };
}
