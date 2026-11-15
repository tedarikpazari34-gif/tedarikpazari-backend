-- CreateTable
CREATE TABLE "IyzicoWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "paymentAttemptId" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3),
    "deliveryCount" INTEGER NOT NULL DEFAULT 1,
    "reviewReason" TEXT,

    CONSTRAINT "IyzicoWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoWebhookEvent_eventKey_key" ON "IyzicoWebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "IyzicoWebhookEvent_paymentAttemptId_idx" ON "IyzicoWebhookEvent"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "IyzicoWebhookEvent_orderId_idx" ON "IyzicoWebhookEvent"("orderId");

-- CreateIndex
CREATE INDEX "IyzicoWebhookEvent_conversationId_idx" ON "IyzicoWebhookEvent"("conversationId");

-- CreateIndex
CREATE INDEX "IyzicoWebhookEvent_status_receivedAt_idx" ON "IyzicoWebhookEvent"("status", "receivedAt");
