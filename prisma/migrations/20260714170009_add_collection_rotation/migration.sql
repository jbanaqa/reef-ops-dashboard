-- CreateTable
CREATE TABLE "CollectionRotation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL,
    "collectionHandle" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastShuffledAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRotationRun" (
    "id" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'Manual',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "previousProductIds" JSONB NOT NULL,
    "shuffledProductIds" JSONB,
    "shopifyJobIds" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionRotationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionRotation_shop_idx" ON "CollectionRotation"("shop");

-- CreateIndex
CREATE INDEX "CollectionRotation_shopifyCollectionId_idx" ON "CollectionRotation"("shopifyCollectionId");

-- CreateIndex
CREATE INDEX "CollectionRotation_isEnabled_idx" ON "CollectionRotation"("isEnabled");

-- CreateIndex
CREATE INDEX "CollectionRotation_lastShuffledAt_idx" ON "CollectionRotation"("lastShuffledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRotation_shop_shopifyCollectionId_key" ON "CollectionRotation"("shop", "shopifyCollectionId");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_rotationId_idx" ON "CollectionRotationRun"("rotationId");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_shop_idx" ON "CollectionRotationRun"("shop");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_shopifyCollectionId_idx" ON "CollectionRotationRun"("shopifyCollectionId");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_status_idx" ON "CollectionRotationRun"("status");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_startedAt_idx" ON "CollectionRotationRun"("startedAt");

-- AddForeignKey
ALTER TABLE "CollectionRotationRun" ADD CONSTRAINT "CollectionRotationRun_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "CollectionRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
