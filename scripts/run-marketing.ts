import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const { runAllMarketingBrands } = await import("../lib/marketing/worker");
    const results = await runAllMarketingBrands();
    console.log(results);
    if (results.some((result) => result.error)) throw new Error("One or more marketing workers failed. See the store-specific errors above.");
  }
  finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
