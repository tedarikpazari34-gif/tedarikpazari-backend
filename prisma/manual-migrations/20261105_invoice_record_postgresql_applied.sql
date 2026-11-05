-- CreateEnum
CREATE TYPE "InvoiceRecordKind" AS ENUM ('SALE', 'RETURN', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceRecordChannel" AS ENUM ('E_INVOICE', 'E_ARCHIVE', 'PAPER');

-- CreateEnum
CREATE TYPE "InvoiceRecordStatus" AS ENUM ('PENDING_REVIEW', 'RECORDED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "reasonCategory" TEXT;

-- AlterTable
ALTER TABLE "DisputeFile" ADD COLUMN     "deliveryType" TEXT,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "resourceType" TEXT;

-- CreateTable
CREATE TABLE "InvoiceRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "disputeId" TEXT,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "issuerCompanyId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "kind" "InvoiceRecordKind" NOT NULL,
    "channel" "InvoiceRecordChannel" NOT NULL,
    "status" "InvoiceRecordStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "invoiceNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "originalSaleInvoiceId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "netAmount" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "storagePublicId" TEXT NOT NULL,
    "storageResourceType" TEXT NOT NULL,
    "storageDeliveryType" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "providerName" TEXT,
    "providerDocumentId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRecord_storagePublicId_key" ON "InvoiceRecord"("storagePublicId");

-- CreateIndex
CREATE INDEX "InvoiceRecord_orderId_createdAt_idx" ON "InvoiceRecord"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceRecord_disputeId_idx" ON "InvoiceRecord"("disputeId");

-- CreateIndex
CREATE INDEX "InvoiceRecord_originalSaleInvoiceId_idx" ON "InvoiceRecord"("originalSaleInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceRecord_buyerId_issuedAt_idx" ON "InvoiceRecord"("buyerId", "issuedAt");

-- CreateIndex
CREATE INDEX "InvoiceRecord_sellerId_issuedAt_idx" ON "InvoiceRecord"("sellerId", "issuedAt");

-- CreateIndex
CREATE INDEX "InvoiceRecord_status_idx" ON "InvoiceRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRecord_issuerCompanyId_invoiceNumber_revision_key" ON "InvoiceRecord"("issuerCompanyId", "invoiceNumber", "revision");

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_issuerCompanyId_fkey" FOREIGN KEY ("issuerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_originalSaleInvoiceId_fkey" FOREIGN KEY ("originalSaleInvoiceId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
