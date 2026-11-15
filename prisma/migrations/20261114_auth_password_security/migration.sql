-- Hesap güvenliği alanları
-- Mevcut kullanıcıların şifreleri ve hesapları korunur.

ALTER TABLE "User"
    ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "passwordResetTokenHash" TEXT,
    ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_passwordResetTokenHash_key"
    ON "User"("passwordResetTokenHash");
