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
    // The full poll is the primary fallback, including new mappings that were
    // not indexed yet. Recover queued receipts only within the remaining budget.
    const budgetMs = Math.min(20_000, startedAt + 110_000 - Date.now());
    if (budgetMs >= 3_000) {
      try {
        const { drainSkuSyncWebhookEvents } = await import("../lib/sku-sync/webhook-queue");
        const result = await drainSkuSyncWebhookEvents({ budgetMs });
        if (result.attempted || result.pruned) console.log("[sku-sync] Webhook recovery:", result);
      } catch {
        console.warn("[sku-sync] Could not recover webhook receipts on this check.");
      }
    }
  } finally { await prisma.$disconnect(); }
}

// Bound this isolated runner so a stalled provider/DB cannot hold up other cron jobs.
// In-flight intent was persisted before writes; a killed/uncertain call is read back next time.
const startedAt = Date.now();
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
