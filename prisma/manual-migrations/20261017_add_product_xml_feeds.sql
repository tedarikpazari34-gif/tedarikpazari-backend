-- Add automatic XML product feed configuration.
-- Additive/manual migration for production PostgreSQL.

CREATE TABLE "ProductXmlFeed" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncLockToken" TEXT,
    "syncLockExpiresAt" TIMESTAMP(3),
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductXmlFeed_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductXmlFeed_syncIntervalMinutes_check"
      CHECK ("syncIntervalMinutes" >= 60 AND "syncIntervalMinutes" <= 10080)
);

CREATE UNIQUE INDEX "ProductXmlFeed_sellerId_url_key"
ON "ProductXmlFeed"("sellerId", "url");

CREATE INDEX "ProductXmlFeed_sellerId_createdAt_idx"
ON "ProductXmlFeed"("sellerId", "createdAt");

CREATE INDEX "ProductXmlFeed_isActive_nextSyncAt_idx"
ON "ProductXmlFeed"("isActive", "nextSyncAt");

ALTER TABLE "ProductXmlFeed"
ADD CONSTRAINT "ProductXmlFeed_sellerId_fkey"
FOREIGN KEY ("sellerId")
REFERENCES "Company"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
