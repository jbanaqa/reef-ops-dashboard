ALTER TABLE "SkuSyncPair"
ADD COLUMN "inventoryItemAId" TEXT,
ADD COLUMN "inventoryItemBId" TEXT;

CREATE INDEX "SkuSyncPair_inventory_a_idx" ON "SkuSyncPair"("sourceKey", "inventoryItemAId");
CREATE INDEX "SkuSyncPair_inventory_b_idx" ON "SkuSyncPair"("sourceKey", "inventoryItemBId");

CREATE TABLE "SkuSyncWebhookShop" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "subscriptionId" TEXT,

    CONSTRAINT "SkuSyncWebhookShop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkuSyncWebhookShop_sourceKey_shop_key" ON "SkuSyncWebhookShop"("sourceKey", "shop");
CREATE UNIQUE INDEX "SkuSyncWebhookShop_sourceKey_side_key" ON "SkuSyncWebhookShop"("sourceKey", "side");

CREATE TABLE "SkuSyncWebhookEvent" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SkuSyncWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkuSyncWebhookEvent_sourceKey_processedAt_dueAt_idx" ON "SkuSyncWebhookEvent"("sourceKey", "processedAt", "dueAt");
CREATE INDEX "SkuSyncWebhookEvent_processedAt_idx" ON "SkuSyncWebhookEvent"("processedAt");
