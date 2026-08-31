-- CreateTable
CREATE TABLE "SpeciesLibraryCard" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "speciesKey" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "scientificName" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "publishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesLibraryCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesCardVersion" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "imagePrompt" TEXT,
    "imageUrl" TEXT,
    "source" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeciesCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesProductLink" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "cardId" TEXT NOT NULL,
    "matchMethod" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesReviewItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "productStatus" TEXT NOT NULL,
    "productDescription" TEXT,
    "productImageUrls" JSONB,
    "productUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "textStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "imageStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "publicationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "candidateCardId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchReasons" JSONB,
    "draftPayload" JSONB,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "imagePrompt" TEXT,
    "imagePromptVersion" INTEGER,
    "generatedImageUrl" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesSyncCheckpoint" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "lastProductUpdatedAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesSyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeciesLibraryCard_shop_idx" ON "SpeciesLibraryCard"("shop");

-- CreateIndex
CREATE INDEX "SpeciesLibraryCard_group_idx" ON "SpeciesLibraryCard"("group");

-- CreateIndex
CREATE INDEX "SpeciesLibraryCard_status_idx" ON "SpeciesLibraryCard"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesLibraryCard_shop_speciesKey_key" ON "SpeciesLibraryCard"("shop", "speciesKey");

-- CreateIndex
CREATE INDEX "SpeciesCardVersion_cardId_idx" ON "SpeciesCardVersion"("cardId");

-- CreateIndex
CREATE INDEX "SpeciesCardVersion_source_idx" ON "SpeciesCardVersion"("source");

-- CreateIndex
CREATE INDEX "SpeciesCardVersion_createdAt_idx" ON "SpeciesCardVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesCardVersion_cardId_version_key" ON "SpeciesCardVersion"("cardId", "version");

-- CreateIndex
CREATE INDEX "SpeciesProductLink_shop_idx" ON "SpeciesProductLink"("shop");

-- CreateIndex
CREATE INDEX "SpeciesProductLink_cardId_idx" ON "SpeciesProductLink"("cardId");

-- CreateIndex
CREATE INDEX "SpeciesProductLink_approvedAt_idx" ON "SpeciesProductLink"("approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesProductLink_shop_shopifyProductId_key" ON "SpeciesProductLink"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_shop_idx" ON "SpeciesReviewItem"("shop");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_status_idx" ON "SpeciesReviewItem"("status");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_kind_idx" ON "SpeciesReviewItem"("kind");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_candidateCardId_idx" ON "SpeciesReviewItem"("candidateCardId");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_productUpdatedAt_idx" ON "SpeciesReviewItem"("productUpdatedAt");

-- CreateIndex
CREATE INDEX "SpeciesReviewItem_createdAt_idx" ON "SpeciesReviewItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesReviewItem_shop_shopifyProductId_sourceFingerprint_key" ON "SpeciesReviewItem"("shop", "shopifyProductId", "sourceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesSyncCheckpoint_shop_key" ON "SpeciesSyncCheckpoint"("shop");

-- CreateIndex
CREATE INDEX "SpeciesSyncCheckpoint_lastCompletedAt_idx" ON "SpeciesSyncCheckpoint"("lastCompletedAt");

-- AddForeignKey
ALTER TABLE "SpeciesCardVersion" ADD CONSTRAINT "SpeciesCardVersion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SpeciesLibraryCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeciesProductLink" ADD CONSTRAINT "SpeciesProductLink_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SpeciesLibraryCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeciesReviewItem" ADD CONSTRAINT "SpeciesReviewItem_candidateCardId_fkey" FOREIGN KEY ("candidateCardId") REFERENCES "SpeciesLibraryCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
