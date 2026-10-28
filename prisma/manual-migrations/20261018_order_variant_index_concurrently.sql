-- Execute separately, with autocommit enabled.
-- Do not wrap this statement in a transaction.
-- Production execution requires explicit approval.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Order_variantId_idx" ON "Order"("variantId");
