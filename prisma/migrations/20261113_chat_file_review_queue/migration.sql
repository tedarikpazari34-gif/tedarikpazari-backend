-- Chat file review queue.
-- Additive migration. Does not enable uploads or approvals.

CREATE TYPE "ChatFileReviewStatus" AS ENUM (
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED'
);

CREATE TABLE "ChatFileReview" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "ChatFileReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatFileReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatFileReview_messageId_key"
ON "ChatFileReview"("messageId");

CREATE INDEX "ChatFileReview_status_createdAt_idx"
ON "ChatFileReview"("status", "createdAt");

ALTER TABLE "ChatFileReview"
ADD CONSTRAINT "ChatFileReview_messageId_fkey"
FOREIGN KEY ("messageId")
REFERENCES "ChatMessage"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
