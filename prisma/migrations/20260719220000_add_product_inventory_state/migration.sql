CREATE TABLE "ProductInventoryState" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productHandle" TEXT,
    "productTitle" TEXT,
    "totalAvailable" INTEGER NOT NULL,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductInventoryState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductInventoryState_shop_productId_key"
ON "ProductInventoryState"("shop", "productId");

CREATE INDEX "ProductInventoryState_shop_idx"
ON "ProductInventoryState"("shop");

CREATE INDEX "ProductInventoryState_productId_idx"
ON "ProductInventoryState"("productId");

CREATE INDEX "ProductInventoryState_totalAvailable_idx"
ON "ProductInventoryState"("totalAvailable");