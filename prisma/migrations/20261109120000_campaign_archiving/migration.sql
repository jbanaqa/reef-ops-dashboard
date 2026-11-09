ALTER TABLE "MarketingCampaign" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "MarketingCampaign_shop_archivedAt_createdAt_idx" ON "MarketingCampaign"("shop", "archivedAt", "createdAt");
