import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  if (process.argv.slice(2).some((value) => value !== "--apply"))
    throw Error("Use optional --apply only.");
  const { prisma } = await import("../lib/prisma");
  const { audienceWhere, json, record, shop } = await import("../lib/marketing/store");
  const { segment } = await import("../lib/marketing/rules");
  try {
    console.log(JSON.stringify(await prisma.$transaction(async (tx) => {
      const row = await tx.marketingResource.findUniqueOrThrow({
        where: { shop_kind_key: { shop: shop(), kind: "SEGMENT", key: "mailable" } },
      });
      const previous = segment(row.data);
      if (!previous.masterMarketing || !previous.klaviyoSegment?.shopifyConsentCheckedAt)
        throw Error("Activate and review the master audience first.");
      const now = new Date();
      if (previous.masterMarketing.engagementDays === 365)
        return { alreadyActive: true, eligible: await tx.marketingProfile.count({ where: audienceWhere(previous, "EMAIL", now) }) };
      if (await tx.marketingResource.count({ where: { shop: shop(), kind: "FLOW", enabled: true } }) ||
          await tx.marketingCampaign.count({ where: { shop: shop(), status: { in: ["SCHEDULED", "SENDING"] } } }) ||
          await tx.marketingMessage.count({ where: { shop: shop(), status: { in: ["SENDING", "UNKNOWN"] } } }))
        throw Error("Pause flows and finish active campaigns before first activation.");
      const next = segment({ ...previous, masterMarketing: { ...previous.masterMarketing, engagementDays: 365 } });
      const before = await tx.marketingProfile.findMany({ where: audienceWhere(previous, "EMAIL", now), select: { id: true }, orderBy: { id: "asc" } });
      const after = await tx.marketingProfile.findMany({ where: audienceWhere(next, "EMAIL", now), select: { id: true }, orderBy: { id: "asc" } });
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw Error("Initial membership would change; review migration baselines before applying.");
      const apply = process.argv.includes("--apply");
      if (apply) {
        await tx.marketingResource.update({ where: { id: row.id }, data: { data: json(next) } });
        await record(tx, {
          key: "master-engagement-enabled:" + previous.masterMarketing.startedAt,
          type: "MASTER_ENGAGEMENT_ENABLED",
          payload: { previousAudience: row.data, audience: next, eligible: after.length, userAuthorized: true },
        });
      }
      return { mode: apply ? "applied" : "preview", eligible: after.length, membersUnchanged: true, audience: next };
    }, { isolationLevel: "Serializable", timeout: 30000 })));
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
