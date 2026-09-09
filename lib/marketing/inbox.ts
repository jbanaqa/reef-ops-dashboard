import { prisma } from "@/lib/prisma";
import { json, shop } from "./store";
import { marketingSettings } from "./rules";
import { setup } from "./delivery";
import { ingestShopify } from "./ingest";

export async function ingestionEnabled() {
  if (process.env.MARKETING_INGEST_ENABLED !== "true") return false;
  const row = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  return setup(marketingSettings(row?.data).operations).ingestEnabled;
}
/** Persist before acknowledging Shopify. Identity reconciliation happens off the order path. */
export async function queueShopify(
  topic: string,
  key: string,
  payload: unknown,
) {
  return prisma.marketingWebhookInbox.upsert({
    where: { shop_key: { shop: shop(), key } },
    create: { shop: shop(), key, topic, payload: json(payload) },
    update: {},
  });
}
export async function processMarketingInbox(limit = 100) {
  if (!(await ingestionEnabled())) return { processed: 0, disabled: true };
  const now = new Date();
  await prisma.marketingWebhookInbox.updateMany({
    where: {
      shop: shop(),
      status: "PROCESSING",
      claimedAt: { lt: new Date(+now - 300000) },
    },
    data: { status: "PENDING", claimedAt: null },
  });
  const rows = await prisma.marketingWebhookInbox.findMany({
    where: { shop: shop(), status: "PENDING", dueAt: { lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  let processed = 0;
  const deadline = Date.now() + 60000;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    if (!(await ingestionEnabled())) break;
    const claimed = await prisma.marketingWebhookInbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        claimedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) continue;
    try {
      await ingestShopify(
        row.topic,
        row.key,
        row.payload as Parameters<typeof ingestShopify>[2],
      );
      await prisma.marketingWebhookInbox.update({
        where: { id: row.id },
        data: { status: "DONE", processedAt: new Date(), error: null },
      });
      processed++;
    } catch (error) {
      await prisma.marketingWebhookInbox.update({
        where: { id: row.id },
        data: {
          status: row.attempts >= 9 ? "FAILED" : "PENDING",
          error: (error instanceof Error
            ? error.message
            : "Ingestion failed"
          ).slice(0, 1000),
          dueAt: new Date(
            Date.now() + Math.min(3600000, 60000 * 2 ** row.attempts),
          ),
        },
      });
    }
  }
  return { processed, disabled: false };
}
export async function inboxUnresolved() {
  return prisma.marketingWebhookInbox.count({
    where: { shop: shop(), status: { not: "DONE" } },
  });
}
