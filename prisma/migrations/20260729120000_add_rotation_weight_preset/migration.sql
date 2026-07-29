-- CreateTable
CREATE TABLE "RotationWeightPreset" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "performanceWeight" INTEGER NOT NULL,
    "exposureWeight" INTEGER NOT NULL,
    "freshnessWeight" INTEGER NOT NULL,
    "explorationWeight" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotationWeightPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RotationWeightPreset_shop_idx" ON "RotationWeightPreset"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RotationWeightPreset_shop_name_key" ON "RotationWeightPreset"("shop", "name");
