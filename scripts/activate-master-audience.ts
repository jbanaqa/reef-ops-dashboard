import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  if (process.argv.slice(2).some(v => v !== "--apply")) throw Error("Use optional --apply only.");
  const { prisma } = await import("../lib/prisma");
  const { audienceWhere, json, record, shop } = await import("../lib/marketing/store");
  const { segment } = await import("../lib/marketing/rules");
  try {
    console.log(JSON.stringify(await prisma.$transaction(async tx => {
      const row = await tx.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: shop(), kind: "SEGMENT", key: "mailable" } } });
      const previous = segment(row.data);
      if (previous.masterMarketing) return { alreadyActive: true, eligible: await tx.marketingProfile.count({ where: audienceWhere(previous) }) };
      if (!previous.klaviyoSegment?.shopifyConsentCheckedAt || previous.openedDays || previous.list || previous.tag)
        throw Error("Use the existing Shopify-reviewed aligned audience as the starting point.");
      if (await tx.marketingResource.count({ where: { shop: shop(), kind: "FLOW", enabled: true } })) throw Error("Pause all flows before activation.");
      if (await tx.marketingCampaign.count({ where: { shop: shop(), status: { in: ["SCHEDULED", "SENDING"] } } }) ||
          await tx.marketingMessage.count({ where: { shop: shop(), status: { in: ["SENDING", "UNKNOWN"] } } })) throw Error("Finish or hold active sends before activation.");
      const before = await tx.marketingProfile.findMany({ where: audienceWhere(previous), select: { id: true }, orderBy: { id: "asc" } });
      const next = segment({ ...previous, masterMarketing: { startedAt: new Date().toISOString() } });
      const apply = process.argv.includes("--apply");
      if (apply) {
        await tx.marketingResource.update({ where: { id: row.id }, data: { data: json(next) } });
        const after = await tx.marketingProfile.findMany({ where: audienceWhere(next), select: { id: true }, orderBy: { id: "asc" } });
        if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Starting membership changed; activation rolled back.");
        await record(tx, { key: "master-audience-activated:" + next.masterMarketing!.startedAt, type: "MASTER_AUDIENCE_ACTIVATED",
          payload: { eligible: before.length, previousAudience: row.data, audience: next, userAuthorized: true } });
      }
      return { mode: apply ? "applied" : "preview", eligible: before.length, startingMembersUnchanged: true, ...next };
    }, { isolationLevel: "Serializable", timeout: 30000 })));
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
