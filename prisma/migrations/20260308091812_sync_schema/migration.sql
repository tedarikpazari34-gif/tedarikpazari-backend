-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "unitType" TEXT NOT NULL,
    "moq" INTEGER NOT NULL,
    "basePrice" DECIMAL NOT NULL DEFAULT 0,
    "price" DECIMAL,
    "leadTimeDays" INTEGER,
    "stockType" TEXT,
    "vatRate" INTEGER,
    "rfqEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("basePrice", "categoryId", "createdAt", "description", "id", "isActive", "isApproved", "leadTimeDays", "moq", "price", "rfqEnabled", "sellerId", "stockType", "title", "unitType", "updatedAt", "vatRate") SELECT "basePrice", "categoryId", "createdAt", "description", "id", "isActive", "isApproved", "leadTimeDays", "moq", "price", "rfqEnabled", "sellerId", "stockType", "title", "unitType", "updatedAt", "vatRate" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_sellerId_idx" ON "Product"("sellerId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_isActive_isApproved_idx" ON "Product"("isActive", "isApproved");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
