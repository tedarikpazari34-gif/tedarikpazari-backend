-- NEX TEDARIK PAZARI
-- Kritik stok uyarisi veritabani hazirligi
-- YALNIZCA INCELEME ICIN HAZIRLANMISTIR.
-- Canli veritabaninda otomatik calistirilmaz.
--
-- Canli sutunlar ve yedekler dogrulanmadan uygulanmamalidir.

BEGIN;

ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "minStockThreshold" INTEGER;

ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "stockAlertActive"
    BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "ProductVariant"
    ADD COLUMN IF NOT EXISTS "minStockThreshold" INTEGER;

ALTER TABLE "ProductVariant"
    ADD COLUMN IF NOT EXISTS "stockAlertActive"
    BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
