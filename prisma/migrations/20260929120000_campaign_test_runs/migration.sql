ALTER TABLE "MarketingCampaign"
ADD COLUMN "testOfCampaignId" TEXT;

CREATE INDEX "MarketingCampaign_shop_testOfCampaignId_createdAt_idx"
ON "MarketingCampaign"("shop", "testOfCampaignId", "createdAt");
