import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audienceWhere, json, record, shop } from "./store";
import { email } from "./rules";
import { klaviyoMailableId, snapshotConsentAllowed, refreshedSnapshotProof } from "./segment-snapshot";

export type MailableSource = {
  id: string; name: string; checkedAt: string;
  members: { id: string; email: string; canReceiveMarketing: boolean }[];
};
type ProfilePage = { data: { id: string; attributes: { email?: string;
  subscriptions?: { email?: { marketing?: { can_receive_email_marketing?: boolean } } } } }[];
  links?: { next?: string } };
async function get<T>(path: string): Promise<T> {
  const url = new URL(path, "https://a.klaviyo.com");
  if (url.origin !== "https://a.klaviyo.com" ||
      !new RegExp(`^/api/segments/${klaviyoMailableId}(/profiles)?/?$`).test(url.pathname))
    throw new Error("Only the 2025 Mailable Subscribers segment may be read.");
  if (!process.env.KLAVIYO_PRIVATE_API_KEY) throw new Error("Missing Klaviyo API key.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: "Klaviyo-API-Key " + process.env.KLAVIYO_PRIVATE_API_KEY,
        revision: "2026-07-15", accept: "application/vnd.api+json" },
      signal: AbortSignal.timeout(45000), redirect: "error",
    });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve,
        Math.min(30000, Math.max(1000, Number(response.headers.get("retry-after") || 2) * 1000))));
      continue;
    }
    if (!response.ok) throw new Error(`Klaviyo segment request failed (${response.status}). No alignment applied.`);
    return response.json() as Promise<T>;
  }
  throw new Error("Klaviyo is busy. No alignment applied.");
}

/** Read only this segment, not the global profile directory or event history. */
export async function fetchMailableSource(): Promise<MailableSource> {
  const meta = await get<{ data: { attributes: { name: string; is_processing: boolean; profile_count: number } } }>(`/api/segments/${klaviyoMailableId}/?additional-fields[segment]=profile_count`);
  if (meta.data?.attributes?.name !== "2025 Mailable Subscribers" || meta.data.attributes.is_processing)
    throw new Error("The source segment must be stable and named 2025 Mailable Subscribers.");
  const members: MailableSource["members"] = [];
  let next: string | undefined = `/api/segments/${klaviyoMailableId}/profiles/?` + new URLSearchParams({
    "page[size]": "100", "fields[profile]": "email,subscriptions", "additional-fields[profile]": "subscriptions",
  });
  const seen = new Set<string>();
  while (next) {
    if (seen.has(next)) throw new Error("Repeated source page. No alignment applied.");
    seen.add(next);
    const page: ProfilePage = await get<ProfilePage>(next);
    if (!Array.isArray(page.data)) throw new Error("Invalid source page.");
    for (const item of page.data) members.push({ id: item.id,
      email: email(item.attributes?.email),
      canReceiveMarketing: item.attributes?.subscriptions?.email?.marketing?.can_receive_email_marketing === true });
    next = page.links?.next || undefined;
  }
  if (members.length !== meta.data.attributes.profile_count)
    throw new Error("Source membership changed while reading it. Retry; nothing was applied.");
  return { id: klaviyoMailableId, name: meta.data.attributes.name, checkedAt: new Date().toISOString(), members };
}

/** Atomic and audience-scoped. Does not alter consent, opens, lists, tags or flows. */
export async function alignMailableSource(source: MailableSource, apply = false) {
  if (source.id !== klaviyoMailableId || source.name !== "2025 Mailable Subscribers" ||
      !source.members.length || !Number.isFinite(Date.parse(source.checkedAt)) ||
      Math.abs(Date.now() - Date.parse(source.checkedAt)) > 3600000)
    throw new Error("Use a complete, freshly read 2025 Mailable Subscribers snapshot.");
  const members = source.members.map((m) => ({ ...m, email: email(m.email) }));
  if (new Set(members.map((m) => m.email)).size !== members.length ||
      members.some((m) => !m.id || m.canReceiveMarketing !== true))
    throw new Error("Duplicate addresses or missing Klaviyo marketability evidence. No alignment applied.");
  const batch = randomUUID();
  return prisma.$transaction(async (tx) => {
    const audience = await tx.marketingResource.findUniqueOrThrow({
      where: { shop_kind_key: { shop: shop(), kind: "SEGMENT", key: "mailable" } },
    });
    const shopifyReviewAt = (audience.data as { klaviyoSegment?: { shopifyConsentCheckedAt?: string } }).klaviyoSegment?.shopifyConsentCheckedAt;
    if ((audience.data as { masterMarketing?: unknown }).masterMarketing)
      throw Error("2025 Mailable Subscribers is now the maintained master audience. Snapshot replacement is disabled.");
    const snapshot = { id: source.id, batch, syncedAt: source.checkedAt,
      ...(shopifyReviewAt ? { shopifyConsentCheckedAt: shopifyReviewAt } : {}) };
    const profiles = await tx.marketingProfile.findMany({ where: { shop: shop(), email: { in: members.map((m) => m.email) } },
      select: { id: true, email: true, properties: true, consents: { where: { channel: "EMAIL" } } } });
    if (profiles.length !== members.length)
      throw new Error(`${members.length - profiles.length} target contacts are missing locally. Nothing imported or changed.`);
    const blocked = profiles.filter((p) => !snapshotConsentAllowed(p.consents[0])).length;
    const allowed = (p: typeof profiles[number]) => refreshedSnapshotProof(p.properties, snapshot).canReceiveMarketing;
    const shopifyExcluded = profiles.filter((p) => !allowed(p)).length;
    const report = { mode: apply ? "apply" : "dry-run", sourceMembers: members.length,
      locallyBlocked: blocked, shopifyExcluded,
      eligible: profiles.filter((p) => snapshotConsentAllowed(p.consents[0]) && allowed(p)).length,
      importedProfiles: 0, syncedAt: source.checkedAt };
    if (!apply) return report;
    const settings = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } } });
    if ((settings?.data as { operations?: { sendingEnabled?: boolean } })?.operations?.sendingEnabled !== false)
      throw new Error("Pause customer sending before alignment.");
    if (await tx.marketingMessage.count({ where: { shop: shop(), status: { in: ["SENDING", "UNKNOWN"] } } }))
      throw new Error("Resolve sending or uncertain messages first.");
    for (let start = 0; start < profiles.length; start += 250) {
      const values = Prisma.join(profiles.slice(start, start + 250).map((p) =>
        Prisma.sql`(${p.id}::text, ${JSON.stringify(refreshedSnapshotProof(p.properties, snapshot))}::jsonb)`));
      await tx.$executeRaw(Prisma.sql`UPDATE "MarketingProfile" AS p
        SET properties = jsonb_set(CASE WHEN jsonb_typeof(p.properties)='object' THEN p.properties ELSE '{}'::jsonb END,
          '{klaviyoMailable}', source.proof), "updatedAt"=NOW()
        FROM (VALUES ${values}) AS source(id, proof) WHERE p.shop=${shop()} AND p.id=source.id`);
    }
    await tx.marketingResource.update({ where: { id: audience.id }, data: { data: json({ klaviyoSegment: snapshot }) } });
    const actual = await tx.marketingProfile.count({ where: audienceWhere({ klaviyoSegment: snapshot }) });
    if (actual !== report.eligible) throw new Error("Eligibility verification failed; alignment rolled back.");
    const digest = createHash("sha256").update(JSON.stringify(members.sort((a,b) => a.email.localeCompare(b.email)))).digest("hex");
    await tx.marketingResource.create({ data: { shop: shop(), kind: "SEGMENT_ALIGNMENT", key: batch,
      name: source.name, data: json({ ...report, snapshot, sourceDigest: digest, previousAudience: audience.data }) } });
    await record(tx, { key: `segment-aligned:${batch}`, type: "SEGMENT_ALIGNED", payload: { ...report, sourceId: source.id, sourceDigest: digest } });
    return report;
  }, { isolationLevel: "Serializable", timeout: 120000 });
}
