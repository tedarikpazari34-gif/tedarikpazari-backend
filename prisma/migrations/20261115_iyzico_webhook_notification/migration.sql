-- CreateTable
CREATE TABLE "IyzicoWebhookNotification" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IyzicoWebhookNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoWebhookNotification_notificationId_key" ON "IyzicoWebhookNotification"("notificationId");

-- CreateIndex
CREATE INDEX "IyzicoWebhookNotification_adminUserId_idx" ON "IyzicoWebhookNotification"("adminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoWebhookNotification_webhookEventId_adminUserId_key" ON "IyzicoWebhookNotification"("webhookEventId", "adminUserId");

-- AddForeignKey
ALTER TABLE "IyzicoWebhookNotification" ADD CONSTRAINT "IyzicoWebhookNotification_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "IyzicoWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IyzicoWebhookNotification" ADD CONSTRAINT "IyzicoWebhookNotification_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IyzicoWebhookNotification" ADD CONSTRAINT "IyzicoWebhookNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
