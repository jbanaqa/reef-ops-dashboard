-- AlterTable
ALTER TABLE "CollectionRotation" ADD COLUMN     "isStarred" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CollectionRotation_isStarred_idx" ON "CollectionRotation"("isStarred");
