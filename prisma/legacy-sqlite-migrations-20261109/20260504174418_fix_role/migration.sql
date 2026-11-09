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
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "iyzicoSubMerchantKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Company" ("address", "createdAt", "email", "id", "iyzicoSubMerchantKey", "name", "phone", "role", "status", "taxNumber", "taxOffice", "verified") SELECT "address", "createdAt", "email", "id", "iyzicoSubMerchantKey", "name", "phone", "role", "status", "taxNumber", "taxOffice", "verified" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
