CREATE TABLE "SkuSyncPair" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "cloudflareId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "variantAId" TEXT NOT NULL,
  "variantBId" TEXT NOT NULL,
  "present" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "initializedAt" TIMESTAMP(3),
  "baselineSkuA" TEXT,
  "baselineSkuB" TEXT,
  "currentSkuA" TEXT,
  "currentSkuB" TEXT,
  "productA" JSONB,
  "productB" JSONB,
  "conflict" BOOLEAN NOT NULL DEFAULT false,
  "pending" JSONB,
  "lastChange" JSONB,
  "error" TEXT,
  "checkedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkuSyncPair_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SkuSyncPair_sourceKey_present_active_idx" ON "SkuSyncPair"("sourceKey", "present", "active");
CREATE TABLE "SkuSyncControl" (
  "id" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastMappingsAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "SkuSyncControl_pkey" PRIMARY KEY ("id")
);
