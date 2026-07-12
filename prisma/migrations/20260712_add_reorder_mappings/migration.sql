-- CreateTable
CREATE TABLE "ReorderMapping" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "normalizedSupplierName" TEXT NOT NULL,
    "thresholdQuantity" INTEGER NOT NULL,
    "orderQuantity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReorderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderVariantMapping" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "shop" TEXT NOT NULL DEFAULT 'corals-anonymous.myshopify.com',
    "productId" TEXT,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "unitsPerVariant" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReorderVariantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReorderMapping_normalizedSupplierName_key" ON "ReorderMapping"("normalizedSupplierName");

-- CreateIndex
CREATE INDEX "ReorderMapping_supplierName_idx" ON "ReorderMapping"("supplierName");

-- CreateIndex
CREATE INDEX "ReorderMapping_isActive_idx" ON "ReorderMapping"("isActive");

-- CreateIndex
CREATE INDEX "ReorderVariantMapping_mappingId_idx" ON "ReorderVariantMapping"("mappingId");

-- CreateIndex
CREATE INDEX "ReorderVariantMapping_variantId_idx" ON "ReorderVariantMapping"("variantId");

-- CreateIndex
CREATE INDEX "ReorderVariantMapping_inventoryItemId_idx" ON "ReorderVariantMapping"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ReorderVariantMapping_isActive_idx" ON "ReorderVariantMapping"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderVariantMapping_mappingId_shop_variantId_key" ON "ReorderVariantMapping"("mappingId", "shop", "variantId");

-- AddForeignKey
ALTER TABLE "ReorderVariantMapping" ADD CONSTRAINT "ReorderVariantMapping_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ReorderMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
