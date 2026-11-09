-- Chat moderasyon inceleme kayitlari.
-- Mevcut mesajlar ve isFlagged bilgisi korunur.
-- Eski isaretli mesajlar inceleme beklemeye devam eder.

ALTER TABLE "ChatMessage"
    ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
    ADD COLUMN IF NOT EXISTS "reviewDecision" TEXT,
    ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

CREATE INDEX IF NOT EXISTS
    "ChatMessage_isFlagged_reviewedAt_idx"
ON "ChatMessage"("isFlagged", "reviewedAt");
