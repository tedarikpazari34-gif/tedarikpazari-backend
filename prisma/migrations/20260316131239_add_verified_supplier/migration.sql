-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "taxOffice" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "role" TEXT NOT NULL,
    "iyzicoSubMerchantKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Company" ("address", "createdAt", "email", "id", "iyzicoSubMerchantKey", "name", "phone", "role", "status", "taxNumber", "taxOffice") SELECT "address", "createdAt", "email", "id", "iyzicoSubMerchantKey", "name", "phone", "role", "status", "taxNumber", "taxOffice" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_User" ("companyId", "createdAt", "email", "id", "password") SELECT "companyId", "createdAt", "email", "id", "password" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
