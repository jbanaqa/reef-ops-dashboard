import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const args = process.argv.slice(2);
    const allowed = /^(--apply|--campaigns|--inbox|--limit=\d+|--after=[\w-]+)$/;
    if (args.some((arg) => !allowed.test(arg))) throw new Error("Use --campaigns or --inbox, optional --apply, --limit=N and --after=CURSOR.");
    const apply = args.includes("--apply");
    if (apply && !args.includes("--campaigns") && !args.includes("--inbox")) throw new Error("Select a maintenance operation before --apply.");
    if (!args.includes("--campaigns") && !args.includes("--inbox")) {
      const tables = await prisma.$queryRaw`
        SELECT relname AS table_name, n_live_tup AS approximate_rows,
          pg_total_relation_size(relid)::text AS total_bytes
        FROM pg_stat_user_tables WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(relid) DESC LIMIT 20`;
      console.log(JSON.stringify(tables, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
      return;
    }
    const { compactCampaignMessages, compactProcessedInbox } = await import("../lib/marketing/storage-maintenance");
    const options = { apply, limit: Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 100),
      after: args.find((arg) => arg.startsWith("--after="))?.slice(8) };
    if (args.includes("--campaigns")) console.log(JSON.stringify(await compactCampaignMessages(options)));
    if (args.includes("--inbox")) console.log(JSON.stringify(await compactProcessedInbox(options)));
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Storage maintenance failed"); process.exitCode = 1; });
