/*
  Warnings:

  - You are about to drop the column `iyzicoCheckoutToken` on the `Order` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "conversationId" TEXT,
    "checkoutToken" TEXT,
    "iyzicoPaymentId" TEXT,
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "totalAmount" DECIMAL NOT NULL,
    "commissionAmount" DECIMAL NOT NULL,
    "escrowAmount" DECIMAL NOT NULL DEFAULT 0,
    "escrowReleased" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" DATETIME,
    "payoutAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iyzicoConversationId" TEXT,
    "iyzicoPaymentId" TEXT,
    "iyzicoPaidAt" DATETIME,
    "iyzicoRawResult" JSONB,
    CONSTRAINT "Order_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("buyerId", "commissionAmount", "createdAt", "escrowAmount", "escrowReleased", "id", "iyzicoConversationId", "iyzicoPaidAt", "iyzicoPaymentId", "iyzicoRawResult", "payoutAmount", "quoteId", "releasedAt", "rfqId", "sellerId", "status", "totalAmount") SELECT "buyerId", "commissionAmount", "createdAt", "escrowAmount", "escrowReleased", "id", "iyzicoConversationId", "iyzicoPaidAt", "iyzicoPaymentId", "iyzicoRawResult", "payoutAmount", "quoteId", "releasedAt", "rfqId", "sellerId", "status", "totalAmount" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_rfqId_key" ON "Order"("rfqId");
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");
CREATE INDEX "Order_sellerId_idx" ON "Order"("sellerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_iyzicoConversationId_idx" ON "Order"("iyzicoConversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_conversationId_idx" ON "PaymentAttempt"("conversationId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_checkoutToken_idx" ON "PaymentAttempt"("checkoutToken");
