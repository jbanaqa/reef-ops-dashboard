-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sku" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "locationName" TEXT,
    "available" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RawInventoryUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "rawPayload" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InventoryMovementWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sku" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "locationName" TEXT,
    "startingAvailable" INTEGER NOT NULL,
    "latestAvailable" INTEGER NOT NULL,
    "netDelta" INTEGER NOT NULL,
    "firstChangeAt" DATETIME NOT NULL,
    "lastChangeAt" DATETIME NOT NULL,
    "finalizeAfter" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sku" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "locationName" TEXT,
    "startingAvailable" INTEGER NOT NULL,
    "endingAvailable" INTEGER NOT NULL,
    "netDelta" INTEGER NOT NULL,
    "matchedOrderQuantity" INTEGER NOT NULL DEFAULT 0,
    "unknownChangeQuantity" INTEGER NOT NULL DEFAULT 0,
    "eventType" TEXT NOT NULL,
    "matchedOrderIds" TEXT,
    "matchedOrderNames" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'Unreviewed',
    "ownerNote" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderInventoryClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "inventoryItemId" TEXT,
    "sku" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "quantitySold" INTEGER NOT NULL,
    "claimedQuantity" INTEGER NOT NULL DEFAULT 0,
    "orderCreatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "InventorySnapshot_shop_idx" ON "InventorySnapshot"("shop");

-- CreateIndex
CREATE INDEX "InventorySnapshot_inventoryItemId_idx" ON "InventorySnapshot"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventorySnapshot_variantId_idx" ON "InventorySnapshot"("variantId");

-- CreateIndex
CREATE INDEX "InventorySnapshot_locationId_idx" ON "InventorySnapshot"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_shop_inventoryItemId_locationId_key" ON "InventorySnapshot"("shop", "inventoryItemId", "locationId");

-- CreateIndex
CREATE INDEX "RawInventoryUpdate_shop_idx" ON "RawInventoryUpdate"("shop");

-- CreateIndex
CREATE INDEX "RawInventoryUpdate_inventoryItemId_idx" ON "RawInventoryUpdate"("inventoryItemId");

-- CreateIndex
CREATE INDEX "RawInventoryUpdate_locationId_idx" ON "RawInventoryUpdate"("locationId");

-- CreateIndex
CREATE INDEX "RawInventoryUpdate_receivedAt_idx" ON "RawInventoryUpdate"("receivedAt");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_shop_idx" ON "InventoryMovementWindow"("shop");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_inventoryItemId_idx" ON "InventoryMovementWindow"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_variantId_idx" ON "InventoryMovementWindow"("variantId");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_locationId_idx" ON "InventoryMovementWindow"("locationId");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_status_idx" ON "InventoryMovementWindow"("status");

-- CreateIndex
CREATE INDEX "InventoryMovementWindow_finalizeAfter_idx" ON "InventoryMovementWindow"("finalizeAfter");

-- CreateIndex
CREATE INDEX "InventoryEvent_shop_idx" ON "InventoryEvent"("shop");

-- CreateIndex
CREATE INDEX "InventoryEvent_inventoryItemId_idx" ON "InventoryEvent"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryEvent_variantId_idx" ON "InventoryEvent"("variantId");

-- CreateIndex
CREATE INDEX "InventoryEvent_locationId_idx" ON "InventoryEvent"("locationId");

-- CreateIndex
CREATE INDEX "InventoryEvent_eventType_idx" ON "InventoryEvent"("eventType");

-- CreateIndex
CREATE INDEX "InventoryEvent_reviewStatus_idx" ON "InventoryEvent"("reviewStatus");

-- CreateIndex
CREATE INDEX "InventoryEvent_detectedAt_idx" ON "InventoryEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "OrderInventoryClaim_shop_idx" ON "OrderInventoryClaim"("shop");

-- CreateIndex
CREATE INDEX "OrderInventoryClaim_orderId_idx" ON "OrderInventoryClaim"("orderId");

-- CreateIndex
CREATE INDEX "OrderInventoryClaim_variantId_idx" ON "OrderInventoryClaim"("variantId");

-- CreateIndex
CREATE INDEX "OrderInventoryClaim_inventoryItemId_idx" ON "OrderInventoryClaim"("inventoryItemId");

-- CreateIndex
CREATE INDEX "OrderInventoryClaim_orderCreatedAt_idx" ON "OrderInventoryClaim"("orderCreatedAt");
