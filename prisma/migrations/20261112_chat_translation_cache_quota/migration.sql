-- CreateTable
CREATE TABLE "ChatMessageTranslation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "targetLanguage" VARCHAR(5) NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "translatedContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessageTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTranslationQuota" (
    "month" VARCHAR(7) NOT NULL,
    "usedCharacters" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatTranslationQuota_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE INDEX "ChatMessageTranslation_messageId_idx" ON "ChatMessageTranslation"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageTranslation_messageId_targetLanguage_sourceHash_key" ON "ChatMessageTranslation"("messageId", "targetLanguage", "sourceHash");

-- AddForeignKey
ALTER TABLE "ChatMessageTranslation" ADD CONSTRAINT "ChatMessageTranslation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ücretsiz kullanım için veritabanı seviyesinde üst sınır.
ALTER TABLE "ChatTranslationQuota"
ADD CONSTRAINT "ChatTranslationQuota_free_limit_check"
CHECK ("usedCharacters" >= 0 AND "usedCharacters" <= 400000);
