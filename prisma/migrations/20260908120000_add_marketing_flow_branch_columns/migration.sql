-- These columns were added to the original marketing migration after some
-- databases had already applied it. Keep this as a forward-only repair so
-- existing deployments receive the current Prisma schema safely.
ALTER TABLE "MarketingMessage"
  ADD COLUMN IF NOT EXISTS "flowStep" INTEGER;

ALTER TABLE "MarketingMessage"
  ADD COLUMN IF NOT EXISTS "flowCondition" TEXT;
