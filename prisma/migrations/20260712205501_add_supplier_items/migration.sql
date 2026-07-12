/*
  Warnings:

  - A unique constraint covering the columns `[supplierItemId]` on the table `ReorderMapping` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[supplierCode]` on the table `ReorderMapping` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ReorderMapping" ADD COLUMN     "supplierCode" TEXT,
ADD COLUMN     "supplierItemId" TEXT;

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "normalizedSupplierName" TEXT NOT NULL,
    "latestAvailableQty" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItem_supplierCode_key" ON "SupplierItem"("supplierCode");

-- CreateIndex
CREATE INDEX "SupplierItem_supplierName_idx" ON "SupplierItem"("supplierName");

-- CreateIndex
CREATE INDEX "SupplierItem_normalizedSupplierName_idx" ON "SupplierItem"("normalizedSupplierName");

-- CreateIndex
CREATE INDEX "SupplierItem_lastSeenAt_idx" ON "SupplierItem"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderMapping_supplierItemId_key" ON "ReorderMapping"("supplierItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderMapping_supplierCode_key" ON "ReorderMapping"("supplierCode");

-- CreateIndex
CREATE INDEX "ReorderMapping_supplierCode_idx" ON "ReorderMapping"("supplierCode");

-- AddForeignKey
ALTER TABLE "ReorderMapping" ADD CONSTRAINT "ReorderMapping_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
