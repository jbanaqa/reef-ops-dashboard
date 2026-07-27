ALTER TABLE "CollectionRotation"
ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'BALANCED',
ADD COLUMN "performanceWeight" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN "exposureWeight" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "freshnessWeight" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "explorationWeight" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "analyticsLookbackDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "CollectionRotationRun"
ADD COLUMN "scoringSnapshot" JSONB;

CREATE TABLE "CollectionProductAnalytics" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productTitle" TEXT,
  "source" TEXT NOT NULL,
  "lookbackDays" INTEGER NOT NULL,
  "productViews" INTEGER NOT NULL DEFAULT 0,
  "listViews" INTEGER NOT NULL DEFAULT 0,
  "listClicks" INTEGER NOT NULL DEFAULT 0,
  "addsToCart" INTEGER NOT NULL DEFAULT 0,
  "purchases" INTEGER NOT NULL DEFAULT 0,
  "unitsSold" INTEGER NOT NULL DEFAULT 0,
  "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowEndedAt" TIMESTAMP(3) NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionProductAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionAnalyticsSync" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Running',
  "lookbackDays" INTEGER NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionAnalyticsSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectionProductAnalytics_shop_productId_source_lookbackDays_key" ON "CollectionProductAnalytics"("shop", "productId", "source", "lookbackDays");
CREATE INDEX "CollectionProductAnalytics_shop_idx" ON "CollectionProductAnalytics"("shop");
CREATE INDEX "CollectionProductAnalytics_productId_idx" ON "CollectionProductAnalytics"("productId");
CREATE INDEX "CollectionProductAnalytics_source_idx" ON "CollectionProductAnalytics"("source");
CREATE INDEX "CollectionProductAnalytics_syncedAt_idx" ON "CollectionProductAnalytics"("syncedAt");
CREATE INDEX "CollectionAnalyticsSync_shop_idx" ON "CollectionAnalyticsSync"("shop");
CREATE INDEX "CollectionAnalyticsSync_source_idx" ON "CollectionAnalyticsSync"("source");
CREATE INDEX "CollectionAnalyticsSync_status_idx" ON "CollectionAnalyticsSync"("status");
CREATE INDEX "CollectionAnalyticsSync_startedAt_idx" ON "CollectionAnalyticsSync"("startedAt");
