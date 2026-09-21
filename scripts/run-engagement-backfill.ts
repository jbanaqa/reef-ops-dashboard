import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const { runEngagementBackfillBatch } = await import(
      "../lib/marketing/engagement-backfill"
    );
    console.log(await runEngagementBackfillBatch());
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
