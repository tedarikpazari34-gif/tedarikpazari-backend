-- Additive stock reservation schema.
-- Production execution requires separate explicit approval.
-- Verify existing column types and enum values before execution.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'StockReservationStatus'
      AND typnamespace = current_schema()::regnamespace
  ) THEN
    CREATE TYPE "StockReservationStatus" AS ENUM (
      'NONE', 'RESERVED', 'COMMITTED', 'RELEASED'
    );
  END IF;
END
$$;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "stockReservationStatus"
  "StockReservationStatus" NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Product"'::regclass
      AND conname = 'Product_reservedQuantity_nonnegative'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_reservedQuantity_nonnegative"
      CHECK ("reservedQuantity" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ProductVariant"'::regclass
      AND conname = 'ProductVariant_reservedQuantity_nonnegative'
  ) THEN
    ALTER TABLE "ProductVariant"
      ADD CONSTRAINT "ProductVariant_reservedQuantity_nonnegative"
      CHECK ("reservedQuantity" >= 0);
  END IF;
END
$$;

COMMIT;
