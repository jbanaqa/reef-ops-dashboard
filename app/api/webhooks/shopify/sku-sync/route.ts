import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSkuSyncNamespace } from "@/lib/sku-sync/runtime";
import { createSkuSyncWebhookReceiver } from "@/lib/sku-sync/webhook";
import { processSkuSyncWebhookEvent } from "@/lib/sku-sync/webhook-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accept = createSkuSyncWebhookReceiver({
    db: prisma,
    namespace: getSkuSyncNamespace,
    enabled: process.env.SKU_SYNC_ENABLED !== "false",
    secrets: { A: process.env.SHOPIFY_CLIENT_SECRET, B: process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET },
  });
  const { status, eventId } = await accept(request);
  if (eventId) {
    after(async () => {
      try { await processSkuSyncWebhookEvent(eventId); }
      catch { console.error("[sku-sync] Webhook processing did not finish; the scheduled check will recover it."); }
    });
  }
  if (status === 503) console.error("[sku-sync] Could not store a Shopify inventory webhook for processing.");
  return new Response(null, { status });
}
