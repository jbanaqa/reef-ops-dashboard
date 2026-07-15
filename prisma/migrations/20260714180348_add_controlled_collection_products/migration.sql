-- AlterTable
ALTER TABLE "CollectionRotation" ADD COLUMN     "controlledTopCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CollectionControlledProduct" (
    "id" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionControlledProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionControlledProduct_rotationId_idx" ON "CollectionControlledProduct"("rotationId");

-- CreateIndex
CREATE INDEX "CollectionControlledProduct_shopifyProductId_idx" ON "CollectionControlledProduct"("shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionControlledProduct_rotationId_position_key" ON "CollectionControlledProduct"("rotationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionControlledProduct_rotationId_shopifyProductId_key" ON "CollectionControlledProduct"("rotationId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "CollectionRotation_controlledTopCount_idx" ON "CollectionRotation"("controlledTopCount");

-- AddForeignKey
ALTER TABLE "CollectionControlledProduct" ADD CONSTRAINT "CollectionControlledProduct_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "CollectionRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
