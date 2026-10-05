DO $$ BEGIN
  CREATE TYPE "ProductImportSource" AS ENUM ('EXCEL', 'XML', 'API');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProductImportStatus" AS ENUM (
    'UPLOADED',
    'VALIDATED',
    'READY',
    'IMPORTING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProductImportRowAction" AS ENUM (
    'NEW',
    'UPDATE',
    'UNCHANGED',
    'ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "sku" TEXT;

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "quantityStep" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_sellerId_sku_key"
ON "Product"("sellerId", "sku");

CREATE TABLE IF NOT EXISTS "ProductImportJob" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "source" "ProductImportSource" NOT NULL,
  "status" "ProductImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "originalFileName" TEXT,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "readyRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "newRows" INTEGER NOT NULL DEFAULT 0,
  "updateRows" INTEGER NOT NULL DEFAULT 0,
  "unchangedRows" INTEGER NOT NULL DEFAULT 0,
  "processedRows" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductImportRow" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "sku" TEXT,
  "action" "ProductImportRowAction" NOT NULL,
  "productId" TEXT,
  "rawData" JSONB NOT NULL,
  "errors" JSONB,
  "normalized" JSONB,
  "processingToken" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductImportJob_sellerId_createdAt_idx"
ON "ProductImportJob"("sellerId", "createdAt");

CREATE INDEX IF NOT EXISTS "ProductImportJob_status_idx"
ON "ProductImportJob"("status");

CREATE INDEX IF NOT EXISTS "ProductImportRow_jobId_action_idx"
ON "ProductImportRow"("jobId", "action");

CREATE INDEX IF NOT EXISTS "ProductImportRow_jobId_sku_idx"
ON "ProductImportRow"("jobId", "sku");

CREATE INDEX IF NOT EXISTS "ProductImportRow_jobId_processedAt_processingStartedAt_idx"
ON "ProductImportRow"("jobId", "processedAt", "processingStartedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductImportRow_jobId_rowNumber_key"
ON "ProductImportRow"("jobId", "rowNumber");

DO $$ BEGIN
  ALTER TABLE "ProductImportJob"
  ADD CONSTRAINT "ProductImportJob_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductImportRow"
  ADD CONSTRAINT "ProductImportRow_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "ProductImportJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
