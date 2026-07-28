-- Adds periodOffset to CollectionProductAnalytics so a "prior window" sync
-- (the lookback window immediately preceding the current one) can be stored
-- alongside the current one instead of overwriting it. This backs the new
-- Sales Momentum sub-metric in collection rotation Performance scoring,
-- which compares recent vs. prior period activity without needing GA4 or
-- any page-view tracking.

ALTER TABLE "CollectionProductAnalytics" ADD COLUMN "periodOffset" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "CollectionProductAnalytics_shop_productId_source_lookbackDays_key";

CREATE UNIQUE INDEX "CollectionProductAnalytics_shop_productId_source_lookbackDays_periodOffset_key" ON "CollectionProductAnalytics"("shop", "productId", "source", "lookbackDays", "periodOffset");
