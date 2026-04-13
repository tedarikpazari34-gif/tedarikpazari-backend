/*
  Warnings:

  - You are about to drop the column `openedBy` on the `Dispute` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionNote` on the `Dispute` table. All the data in the column will be lost.
  - Added the required column `buyerId` to the `Dispute` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerId` to the `Dispute` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Dispute" ("createdAt", "id", "orderId", "reason", "resolvedAt", "status") SELECT "createdAt", "id", "orderId", "reason", "resolvedAt", "status" FROM "Dispute";
DROP TABLE "Dispute";
ALTER TABLE "new_Dispute" RENAME TO "Dispute";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
