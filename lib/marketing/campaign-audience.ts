import type { Prisma } from "@/app/generated/prisma/client";
import type { Segment } from "./rules";
import { eligible, matches, segment } from "./rules";
import { inSegmentSnapshot, inMasterMarketingAudience, masterEngagementAllowed, snapshotConsentAllowed } from "./segment-snapshot";
import type { Tx } from "./store";
import { audienceWhere, segmentWhere, shop } from "./store";

export type CampaignAudience = {
  version: 2;
  includeKeys: string[];
  excludeKeys: string[];
};

export type ResolvedCampaignAudience = {
  config: CampaignAudience | null;
  includes: Segment[];
  excludes: Segment[];
  missingKeys: string[];
  legacy?: Segment;
  master?: Segment;
};

const keys = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").slice(0, 100))
        .filter(Boolean),
    ),
  ).slice(0, 100);

export function campaignAudience(value: unknown): CampaignAudience | Segment {
  const v = (value || {}) as Partial<CampaignAudience>;
  if (v.version === 2)
    return {
      version: 2,
      includeKeys: keys(v.includeKeys),
      excludeKeys: keys(v.excludeKeys).filter(
        (key) => !keys(v.includeKeys).includes(key),
      ),
    };
  return segment(value);
}

export async function resolveCampaignAudience(
  tx: Tx,
  value: unknown,
): Promise<ResolvedCampaignAudience> {
  const parsed = campaignAudience(value);
  const masterRow = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "SEGMENT", key: "mailable" } } });
  const master = (masterRow?.data as { masterMarketing?: unknown } | undefined)?.masterMarketing ? segment(masterRow!.data) : undefined;
  if (!("version" in parsed))
    return {
      config: null,
      includes: [],
      excludes: [],
      missingKeys: [],
      legacy: parsed,
      master,
    };
  const requested = Array.from(
    new Set([...parsed.includeKeys, ...parsed.excludeKeys]),
  );
  const rows = requested.length
    ? await tx.marketingResource.findMany({
        where: { shop: shop(), kind: "SEGMENT", key: { in: requested } },
        select: { key: true, data: true },
      })
    : [];
  const byKey = new Map(rows.map((row) => [row.key, segment(row.data)]));
  return {
    config: parsed,
    includes: parsed.includeKeys.flatMap((key) =>
      byKey.has(key) ? [byKey.get(key)!] : [],
    ),
    excludes: parsed.excludeKeys.flatMap((key) =>
      byKey.has(key) ? [byKey.get(key)!] : [],
    ),
    missingKeys: requested.filter((key) => !byKey.has(key)),
    master,
  };
}

export function resolvedAudienceWhere(
  resolved: ResolvedCampaignAudience,
  channel = "EMAIL",
  now = new Date(),
): Prisma.MarketingProfileWhereInput {
  if (resolved.legacy) return { AND: [audienceWhere(resolved.legacy, channel, now), ...(resolved.master ? [audienceWhere(resolved.master, channel, now)] : [])] };
  if (resolved.missingKeys.length)
    return { shop: shop(), id: "missing-campaign-audience" };
  return {
    AND: [
      ...(resolved.master ? [audienceWhere(resolved.master, channel, now)] : []),
      ...(resolved.includes.length
        ? [{ OR: resolved.includes.map((item) => audienceWhere(item, channel, now)) }]
        : [audienceWhere(resolved.master || {}, channel, now)]),
      ...(resolved.excludes.length
        ? [{ NOT: { OR: resolved.excludes.map((item) => segmentWhere(item, now)) } }]
        : []),
    ],
  };
}

/** Does not change flow consent or general subscriber eligibility. */
export function campaignConsentEligible(
  profile: { properties?: unknown; lastOpenedAt?: Date | null; consents: { channel: string; status: string; suppressed: boolean }[] },
  resolved: ResolvedCampaignAudience,
  channel = "EMAIL",
  now = new Date(),
) {
  const consent = profile.consents.find((item) => item.channel === channel);
  if (resolved.missingKeys.length) return false;
  const standard = eligible(consent);
  if (resolved.master?.klaviyoSegment && resolved.master.masterMarketing &&
      (!snapshotConsentAllowed(profile.consents.find(item => item.channel === "EMAIL")) ||
       !inMasterMarketingAudience(profile.properties, resolved.master.klaviyoSegment, resolved.master.masterMarketing.startedAt) ||
       !masterEngagementAllowed({ properties: profile.properties, lastOpenedAt: profile.lastOpenedAt || null }, resolved.master.klaviyoSegment, resolved.master.masterMarketing, now))) return false;
  if (channel !== "EMAIL") return standard;
  const rules = resolved.legacy ? [resolved.legacy] : resolved.includes;
  if (!rules.length) return resolved.master ? snapshotConsentAllowed(consent) : standard;
  return rules.some((rule) => rule.klaviyoSegment
    ? snapshotConsentAllowed(consent) && (rule.masterMarketing
      ? inMasterMarketingAudience(profile.properties, rule.klaviyoSegment, rule.masterMarketing.startedAt)
      : inSegmentSnapshot(profile.properties, rule.klaviyoSegment))
    : standard);
}

export function resolvedAudienceMatches(
  profile: Parameters<typeof matches>[0],
  resolved: ResolvedCampaignAudience,
  now = new Date(),
) {
  if (resolved.master && !matches(profile, resolved.master, now)) return false;
  if (resolved.legacy) return matches(profile, resolved.legacy, now);
  if (resolved.missingKeys.length) return false;
  return (
    (!resolved.includes.length ||
      resolved.includes.some((item) => matches(profile, item, now))) &&
    !resolved.excludes.some((item) => matches(profile, item, now))
  );
}
