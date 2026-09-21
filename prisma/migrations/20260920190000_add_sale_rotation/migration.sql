CREATE TABLE "SaleRotationSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "saleCollectionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "rotationIntervalHours" INTEGER NOT NULL DEFAULT 72,
    "discountCount5" INTEGER NOT NULL DEFAULT 30,
    "discountCount10" INTEGER NOT NULL DEFAULT 17,
    "discountCount15" INTEGER NOT NULL DEFAULT 9,
    "discountCount20" INTEGER NOT NULL DEFAULT 4,
    "lastRotatedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaleRotationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleRotationProduct" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "handle" TEXT,
    "imageUrl" TEXT,
    "regularPrice" DOUBLE PRECISION NOT NULL,
    "discountPercent" INTEGER,
    "eligibleForRotation" BOOLEAN NOT NULL DEFAULT true,
    "twentyPercentCandidate" BOOLEAN NOT NULL DEFAULT false,
    "fixedInSale" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaleRotationProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleRotationRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'Manual',
    "status" TEXT NOT NULL DEFAULT 'Running',
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaleRotationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleRotationItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assignedDiscountPercent" INTEGER,
    "regularPrice" DOUBLE PRECISION NOT NULL,
    "salePrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleRotationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleRotationSettings_shop_key" ON "SaleRotationSettings"("shop");
CREATE INDEX "SaleRotationSettings_enabled_idx" ON "SaleRotationSettings"("enabled");
CREATE INDEX "SaleRotationSettings_lastRotatedAt_idx" ON "SaleRotationSettings"("lastRotatedAt");
CREATE UNIQUE INDEX "SaleRotationProduct_shop_shopifyVariantId_key" ON "SaleRotationProduct"("shop", "shopifyVariantId");
CREATE UNIQUE INDEX "SaleRotationProduct_shop_shopifyProductId_key" ON "SaleRotationProduct"("shop", "shopifyProductId");
CREATE INDEX "SaleRotationProduct_shop_active_eligibleForRotation_idx" ON "SaleRotationProduct"("shop", "active", "eligibleForRotation");
CREATE INDEX "SaleRotationProduct_shop_twentyPercentCandidate_fixedInSale_idx" ON "SaleRotationProduct"("shop", "twentyPercentCandidate", "fixedInSale");
CREATE INDEX "SaleRotationProduct_shopifyProductId_idx" ON "SaleRotationProduct"("shopifyProductId");
CREATE INDEX "SaleRotationRun_shop_startedAt_idx" ON "SaleRotationRun"("shop", "startedAt");
CREATE INDEX "SaleRotationRun_shop_status_idx" ON "SaleRotationRun"("shop", "status");
CREATE INDEX "SaleRotationItem_runId_idx" ON "SaleRotationItem"("runId");
CREATE INDEX "SaleRotationItem_productId_createdAt_idx" ON "SaleRotationItem"("productId", "createdAt");

ALTER TABLE "SaleRotationItem" ADD CONSTRAINT "SaleRotationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SaleRotationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleRotationItem" ADD CONSTRAINT "SaleRotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaleRotationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
