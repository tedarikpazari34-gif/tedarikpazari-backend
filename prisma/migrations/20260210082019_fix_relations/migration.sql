/*
  Warnings:

  - You are about to drop the column `buyerNote` on the `RFQ` table. All the data in the column will be lost.
  - You are about to drop the column `expiresAt` on the `RFQ` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RFQ" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RFQ_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RFQ_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RFQ" ("buyerId", "createdAt", "id", "productId", "quantity", "status") SELECT "buyerId", "createdAt", "id", "productId", "quantity", "status" FROM "RFQ";
DROP TABLE "RFQ";
ALTER TABLE "new_RFQ" RENAME TO "RFQ";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
