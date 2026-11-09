/*
  Warnings:

  - You are about to drop the column `createdAt` on the `CompanyWallet` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `CompanyWallet` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanyWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "available" DECIMAL NOT NULL DEFAULT 0,
    "locked" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyWallet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompanyWallet" ("available", "companyId", "id", "locked", "updatedAt") SELECT "available", "companyId", "id", "locked", "updatedAt" FROM "CompanyWallet";
DROP TABLE "CompanyWallet";
ALTER TABLE "new_CompanyWallet" RENAME TO "CompanyWallet";
CREATE UNIQUE INDEX "CompanyWallet_companyId_key" ON "CompanyWallet"("companyId");
CREATE INDEX "CompanyWallet_companyId_idx" ON "CompanyWallet"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
