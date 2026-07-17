-- CreateTable
CREATE TABLE "ProductRestockWaitlist" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productHandle" TEXT,
    "productTitle" TEXT,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Waiting',
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRestockWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRestockWaitlist_unsubscribeToken_key" ON "ProductRestockWaitlist"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRestockWaitlist_active_waiting_key" ON "ProductRestockWaitlist"("shop", "productId", "email") WHERE "status" = 'Waiting';

-- CreateIndex
CREATE INDEX "ProductRestockWaitlist_shop_idx" ON "ProductRestockWaitlist"("shop");

-- CreateIndex
CREATE INDEX "ProductRestockWaitlist_productId_idx" ON "ProductRestockWaitlist"("productId");

-- CreateIndex
CREATE INDEX "ProductRestockWaitlist_email_idx" ON "ProductRestockWaitlist"("email");

-- CreateIndex
CREATE INDEX "ProductRestockWaitlist_status_idx" ON "ProductRestockWaitlist"("status");

-- CreateIndex
CREATE INDEX "ProductRestockWaitlist_subscribedAt_idx" ON "ProductRestockWaitlist"("subscribedAt");
