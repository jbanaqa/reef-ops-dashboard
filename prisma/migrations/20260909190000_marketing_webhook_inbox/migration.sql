CREATE TABLE "MarketingWebhookInbox" (
  "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "key" TEXT NOT NULL,
  "topic" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimedAt" TIMESTAMP(3),
  "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3),
  CONSTRAINT "MarketingWebhookInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingWebhookInbox_shop_key_key" ON "MarketingWebhookInbox"("shop", "key");
CREATE INDEX "MarketingWebhookInbox_shop_status_dueAt_idx" ON "MarketingWebhookInbox"("shop", "status", "dueAt");
