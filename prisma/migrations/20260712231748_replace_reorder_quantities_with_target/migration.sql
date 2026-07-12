/*
  Warnings:

  - You are about to drop the column `orderQuantity` on the `ReorderMapping` table. All the data in the column will be lost.
  - You are about to drop the column `thresholdQuantity` on the `ReorderMapping` table. All the data in the column will be lost.
  - Added the required column `targetStockQuantity` to the `ReorderMapping` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ReorderMapping"
ADD COLUMN "targetStockQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ReorderMapping"
DROP COLUMN "thresholdQuantity";

ALTER TABLE "ReorderMapping"
DROP COLUMN "orderQuantity";

ALTER TABLE "ReorderMapping"
ALTER COLUMN "targetStockQuantity" DROP DEFAULT;