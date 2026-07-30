-- AlterTable
ALTER TABLE "CollectionRotation" ADD COLUMN     "controlledBottomCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CollectionControlledProduct" ADD COLUMN     "zone" TEXT NOT NULL DEFAULT 'TOP';

-- DropIndex
DROP INDEX "CollectionControlledProduct_rotationId_position_key";

-- CreateIndex
CREATE UNIQUE INDEX "CollectionControlledProduct_rotationId_zone_position_key" ON "CollectionControlledProduct"("rotationId", "zone", "position");

-- CreateIndex
CREATE INDEX "CollectionControlledProduct_zone_idx" ON "CollectionControlledProduct"("zone");

-- CreateIndex
CREATE INDEX "CollectionRotation_controlledBottomCount_idx" ON "CollectionRotation"("controlledBottomCount");
