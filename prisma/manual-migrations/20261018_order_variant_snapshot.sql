-- Additive only. Production execution requires explicit approval.
-- Verify existing column types before executing.
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "variantId" TEXT,
  ADD COLUMN IF NOT EXISTS "variantName" TEXT,
  ADD COLUMN IF NOT EXISTS "variantSku" TEXT,
  ADD COLUMN IF NOT EXISTS "variantBarcode" TEXT,
  ADD COLUMN IF NOT EXISTS "unitPriceSnapshot" DECIMAL(65,30);

COMMIT;
