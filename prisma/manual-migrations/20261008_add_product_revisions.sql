-- CreateEnum
CREATE TYPE "ProductRevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ProductRevision" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "ProductRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "proposedData" JSONB NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRevision_productId_status_idx" ON "ProductRevision"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductRevision_sellerId_status_idx" ON "ProductRevision"("sellerId", "status");

-- CreateIndex
CREATE INDEX "ProductRevision_status_createdAt_idx" ON "ProductRevision"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Her ürün için yalnızca bir bekleyen revizyon
CREATE UNIQUE INDEX "ProductRevision_one_pending_per_product_idx"
ON "ProductRevision"("productId")
WHERE "status" = 'PENDING';
