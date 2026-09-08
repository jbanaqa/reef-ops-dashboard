-- CreateTable
CREATE TABLE "MarketingProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "shopifyId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lists" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "properties" JSONB NOT NULL DEFAULT '{}',
    "lastOpenedAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsent" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEVER_SUBSCRIBED',
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "profileId" TEXT,
    "anonymousId" TEXT,
    "messageId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "content" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "expandedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMessage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "campaignId" TEXT,
    "flowKey" TEXT,
    "flowStep" INTEGER,
    "flowCondition" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "triggerAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "error" TEXT,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingResource" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProfile_shop_email_key" ON "MarketingProfile"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProfile_shop_phone_key" ON "MarketingProfile"("shop", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProfile_shop_shopifyId_key" ON "MarketingProfile"("shop", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConsent_profileId_channel_key" ON "MarketingConsent"("profileId", "channel");

-- CreateIndex
CREATE INDEX "MarketingEvent_shop_type_occurredAt_idx" ON "MarketingEvent"("shop", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_profileId_type_occurredAt_idx" ON "MarketingEvent"("profileId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_anonymousId_idx" ON "MarketingEvent"("anonymousId");

-- CreateIndex
CREATE INDEX "MarketingEvent_messageId_idx" ON "MarketingEvent"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEvent_shop_key_key" ON "MarketingEvent"("shop", "key");

-- CreateIndex
CREATE INDEX "MarketingCampaign_shop_status_scheduledAt_idx" ON "MarketingCampaign"("shop", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_key_key" ON "MarketingMessage"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_providerId_key" ON "MarketingMessage"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_token_key" ON "MarketingMessage"("token");

-- CreateIndex
CREATE INDEX "MarketingMessage_shop_status_dueAt_idx" ON "MarketingMessage"("shop", "status", "dueAt");

-- CreateIndex
CREATE INDEX "MarketingMessage_profileId_flowKey_idx" ON "MarketingMessage"("profileId", "flowKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingResource_shop_kind_key_key" ON "MarketingResource"("shop", "kind", "key");

-- AddForeignKey
ALTER TABLE "MarketingConsent" ADD CONSTRAINT "MarketingConsent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MarketingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MarketingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MarketingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
