import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.SKU_SYNC_ENABLED === "false") {
    console.log("[sku-sync] Automatic SKU synchronization is paused.");
    return;
  }
  const { getSkuSyncService, skuSyncSetupError } = await import("../lib/sku-sync/runtime");
  const setup = skuSyncSetupError();
  if (setup) { console.log(`[sku-sync] Skipped: ${setup}`); return; }
  const { prisma } = await import("../lib/prisma");
  try {
    console.log("[sku-sync] Checking Cloudflare mappings and mapped SKUs.");
    console.log("[sku-sync]", await getSkuSyncService().run());
  } finally { await prisma.$disconnect(); }
}

// Bound this isolated runner so a stalled provider/DB cannot hold up other cron jobs.
// In-flight intent was persisted before writes; a killed/uncertain call is read back next time.
const watchdog = setTimeout(() => {
  console.error("[sku-sync] Check exceeded its time budget. The next check will inspect saved pending updates.");
  process.exit(1);
}, 120_000);
main().then(() => {
  clearTimeout(watchdog);
  process.exit(0);
}, () => {
  clearTimeout(watchdog);
  console.error("[sku-sync] Scheduled SKU synchronization failed. Check SKU Sync in Reef Ops; unconfirmed updates are not blindly retried.");
  process.exit(1);
});
