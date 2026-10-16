// A source membership snapshot is separate from a customer's subscription.
// It authorizes only campaigns explicitly using this one migrated audience.
export const klaviyoMailableId = "Rr5yRa";
export type SegmentSnapshot = { id: string; batch: string; syncedAt: string };
export function segmentSnapshot(value: unknown): SegmentSnapshot | undefined {
  if (value == null) return undefined;
  const v = value as Partial<SegmentSnapshot>;
  if (v.id !== klaviyoMailableId || typeof v.batch !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.batch) || typeof v.syncedAt !== "string" ||
      !Number.isFinite(Date.parse(v.syncedAt)))
    throw new Error("Invalid Klaviyo audience snapshot.");
  return { id: v.id, batch: v.batch, syncedAt: v.syncedAt };
}
export function inSegmentSnapshot(properties: unknown, snapshot: SegmentSnapshot) {
  const proof = (properties as { klaviyoMailable?: Record<string, unknown> } | null)?.klaviyoMailable;
  return proof?.id === snapshot.id && proof.batch === snapshot.batch &&
    proof.canReceiveMarketing === true;
}
export function snapshotConsentAllowed(consent: { status: string; suppressed: boolean } | null | undefined) {
  return !consent?.suppressed && (!consent || ["SUBSCRIBED", "NEVER_SUBSCRIBED"].includes(consent.status));
}
