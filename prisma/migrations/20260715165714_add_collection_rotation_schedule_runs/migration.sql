-- CreateTable
CREATE TABLE "CollectionRotationScheduleRun" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Running',
    "enabledCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionRotationScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRotationScheduleRun_scheduledFor_key" ON "CollectionRotationScheduleRun"("scheduledFor");

-- CreateIndex
CREATE INDEX "CollectionRotationScheduleRun_scheduledFor_idx" ON "CollectionRotationScheduleRun"("scheduledFor");

-- CreateIndex
CREATE INDEX "CollectionRotationScheduleRun_status_idx" ON "CollectionRotationScheduleRun"("status");

-- CreateIndex
CREATE INDEX "CollectionRotationScheduleRun_startedAt_idx" ON "CollectionRotationScheduleRun"("startedAt");

-- CreateIndex
CREATE INDEX "CollectionRotationRun_triggerType_idx" ON "CollectionRotationRun"("triggerType");
