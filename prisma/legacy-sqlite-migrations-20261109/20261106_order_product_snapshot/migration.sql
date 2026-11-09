-- Siparis snapshot alanlari.
-- Mevcut siparis verileri degistirilmez.
-- Var olan sutunlar yeniden olusturulmaz.
ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "unitPriceSnapshot" DECIMAL(65,30),
    ADD COLUMN IF NOT EXISTS "productTitleSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "productSkuSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "unitTypeSnapshot" TEXT;
