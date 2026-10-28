-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('OPEN', 'EVIDENCE_PREPARING', 'EVIDENCE_SUBMITTED', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

-- CreateTable
CREATE TABLE "ChargebackCase" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'IYZICO',
    "providerReference" TEXT NOT NULL,
    "iyzicoPaymentId" TEXT NOT NULL,
    "disputedAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
    "notifiedAt" TIMESTAMP(3) NOT NULL,
    "responseDueAt" TIMESTAMP(3),
    "evidenceSubmittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargebackCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargebackEvidence" (
    "id" TEXT NOT NULL,
    "chargebackId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "cloudinaryResourceType" TEXT NOT NULL,
    "cloudinaryDeliveryType" TEXT NOT NULL DEFAULT 'authenticated',
    "fileName" TEXT,
    "fileType" TEXT,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargebackEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargebackEvent" (
    "id" TEXT NOT NULL,
    "chargebackId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" "ChargebackStatus",
    "nextStatus" "ChargebackStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargebackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargebackCase_providerReference_key" ON "ChargebackCase"("providerReference");

-- CreateIndex
CREATE INDEX "ChargebackCase_orderId_status_idx" ON "ChargebackCase"("orderId", "status");

-- CreateIndex
CREATE INDEX "ChargebackCase_status_responseDueAt_idx" ON "ChargebackCase"("status", "responseDueAt");

-- CreateIndex
CREATE INDEX "ChargebackCase_iyzicoPaymentId_idx" ON "ChargebackCase"("iyzicoPaymentId");

-- CreateIndex
CREATE INDEX "ChargebackCase_createdAt_idx" ON "ChargebackCase"("createdAt");

-- CreateIndex
CREATE INDEX "ChargebackEvidence_chargebackId_createdAt_idx" ON "ChargebackEvidence"("chargebackId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChargebackEvidence_cloudinaryPublicId_cloudinaryResourceTyp_key" ON "ChargebackEvidence"("cloudinaryPublicId", "cloudinaryResourceType", "cloudinaryDeliveryType");

-- CreateIndex
CREATE INDEX "ChargebackEvent_chargebackId_createdAt_idx" ON "ChargebackEvent"("chargebackId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvidence" ADD CONSTRAINT "ChargebackEvidence_chargebackId_fkey" FOREIGN KEY ("chargebackId") REFERENCES "ChargebackCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvidence" ADD CONSTRAINT "ChargebackEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvent" ADD CONSTRAINT "ChargebackEvent_chargebackId_fkey" FOREIGN KEY ("chargebackId") REFERENCES "ChargebackCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvent" ADD CONSTRAINT "ChargebackEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

