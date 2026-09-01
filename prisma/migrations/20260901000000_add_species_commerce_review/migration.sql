ALTER TABLE "SpeciesLibraryCard"
ADD COLUMN "commerceMode" TEXT NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN "commerceProductHandle" TEXT,
ADD COLUMN "commerceSearchQuery" TEXT,
ADD COLUMN "commerceShopUrl" TEXT,
ADD COLUMN "commerceReviewStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN "commerceReviewedAt" TIMESTAMP(3),
ADD COLUMN "commerceReviewedBy" TEXT;

UPDATE "SpeciesLibraryCard"
SET
  "commerceShopUrl" = "payload"->>'shopUrl',
  "commerceMode" = CASE
    WHEN "payload"->>'shopUrl' LIKE '%/products/%' THEN 'DIRECT'
    WHEN "payload"->>'shopUrl' LIKE '%/search?%' THEN 'SEARCH'
    ELSE 'UNAVAILABLE'
  END,
  "commerceProductHandle" = CASE
    WHEN "payload"->>'shopUrl' LIKE '%/products/%'
      THEN split_part(split_part("payload"->>'shopUrl', '/products/', 2), '?', 1)
    ELSE NULL
  END,
  "commerceReviewStatus" = 'LEGACY_APPROVED';

CREATE INDEX "SpeciesLibraryCard_commerceReviewStatus_idx" ON "SpeciesLibraryCard"("commerceReviewStatus");
