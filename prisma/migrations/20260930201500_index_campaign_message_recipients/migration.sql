-- Speed up campaign audience expansion, which excludes profiles that already
-- have a message for the campaign.
CREATE INDEX "MarketingMessage_campaignId_profileId_idx"
ON "MarketingMessage"("campaignId", "profileId");
