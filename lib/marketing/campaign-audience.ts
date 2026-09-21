import type { Prisma } from "@/app/generated/prisma/client";
import type { Segment } from "./rules";
import { matches, segment } from "./rules";
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
  if (!("version" in parsed))
    return {
      config: null,
      includes: [],
      excludes: [],
      missingKeys: [],
      legacy: parsed,
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
  };
}

export function resolvedAudienceWhere(
  resolved: ResolvedCampaignAudience,
  channel = "EMAIL",
  now = new Date(),
): Prisma.MarketingProfileWhereInput {
  if (resolved.legacy) return audienceWhere(resolved.legacy, channel, now);
  if (resolved.missingKeys.length)
    return { shop: shop(), id: "missing-campaign-audience" };
  return {
    AND: [
      audienceWhere({}, channel, now),
      ...(resolved.includes.length
        ? [{ OR: resolved.includes.map((item) => segmentWhere(item, now)) }]
        : []),
      ...(resolved.excludes.length
        ? [{ NOT: { OR: resolved.excludes.map((item) => segmentWhere(item, now)) } }]
        : []),
    ],
  };
}

export function resolvedAudienceMatches(
  profile: Parameters<typeof matches>[0],
  resolved: ResolvedCampaignAudience,
  now = new Date(),
) {
  if (resolved.legacy) return matches(profile, resolved.legacy, now);
  if (resolved.missingKeys.length) return false;
  return (
    (!resolved.includes.length ||
      resolved.includes.some((item) => matches(profile, item, now))) &&
    !resolved.excludes.some((item) => matches(profile, item, now))
  );
}
