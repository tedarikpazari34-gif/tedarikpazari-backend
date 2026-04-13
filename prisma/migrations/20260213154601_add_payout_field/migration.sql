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
    "payoutAmount" DECIMAL NOT NULL DEFAULT 0,
    "escrowAmount" DECIMAL NOT NULL DEFAULT 0,
    "escrowReleased" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("buyerId", "commissionAmount", "createdAt", "escrowAmount", "escrowReleased", "id", "quoteId", "releasedAt", "rfqId", "sellerId", "status", "totalAmount") SELECT "buyerId", "commissionAmount", "createdAt", "escrowAmount", "escrowReleased", "id", "quoteId", "releasedAt", "rfqId", "sellerId", "status", "totalAmount" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_rfqId_key" ON "Order"("rfqId");
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
