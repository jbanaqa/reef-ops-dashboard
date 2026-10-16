import type { Tx } from "./store";
import { inMasterMarketingAudience, segmentSnapshot } from "./segment-snapshot";

type MasterConfig = { masterMarketing?: { startedAt: string }; klaviyoSegment?: unknown };
const key = (shop: string) => ({ shop_kind_key: { shop, kind: "SEGMENT", key: "mailable" } });

/** Only newly accepted first-party consent can extend the reviewed starting audience. */
export async function joinMasterAudience(tx: Tx, shop: string, profileId: string, source: string, at: Date) {
  if (source !== "shopify" && !["storefront-single-opt-in-v1", "storefront-confirmed-v2", "storefront-resubscribe-confirmed-v1"].includes(source)) return;
  const row = await tx.marketingResource.findUnique({ where: key(shop) });
  const config = row?.data as MasterConfig | undefined;
  if (!config?.masterMarketing || at < new Date(config.masterMarketing.startedAt)) return;
  const snapshot = segmentSnapshot(config.klaviyoSegment);
  if (!snapshot) throw Error("Master audience starting membership is missing");
  const p = await tx.marketingProfile.findUniqueOrThrow({ where: { id: profileId }, include: { consents: { where: { channel: "EMAIL" } } } });
  const c = p.consents[0];
  if (p.shop !== shop || !p.email || c?.status !== "SUBSCRIBED" || c.suppressed) return;
  if (inMasterMarketingAudience(p.properties, snapshot, config.masterMarketing.startedAt)) return;
  await tx.marketingProfile.update({ where: { id: p.id }, data: { properties: {
    ...(p.properties as object),
    masterMarketing: { startedAt: config.masterMarketing.startedAt, joinedAt: at.toISOString(), source },
  } } });
  await tx.marketingEvent.upsert({ where: { shop_key: { shop, key: `master-audience:${p.id}:${config.masterMarketing.startedAt}` } },
    create: { shop, key: `master-audience:${p.id}:${config.masterMarketing.startedAt}`, type: "MASTER_AUDIENCE_JOINED", profileId: p.id, occurredAt: at,
      payload: { audience: "2025 Mailable Subscribers", source } }, update: {} });
}

/** No change to legacy installations until the reviewed audience is explicitly activated. */
export async function masterAudienceAllows(tx: Tx, shop: string, profileId: string) {
  const row = await tx.marketingResource.findUnique({ where: key(shop) });
  const config = row?.data as MasterConfig | undefined;
  if (!config?.masterMarketing) return true;
  const snapshot = segmentSnapshot(config.klaviyoSegment);
  if (!snapshot) return false;
  const p = await tx.marketingProfile.findUnique({ where: { id: profileId }, select: { shop: true, properties: true } });
  return p?.shop === shop && inMasterMarketingAudience(p.properties, snapshot, config.masterMarketing.startedAt);
}

export const customerMarketingFlows = new Set(["welcome", "b2b-welcome", "abandoned-cart", "delivery-upsell"]);
