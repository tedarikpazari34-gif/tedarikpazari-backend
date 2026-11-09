-- AlterTable
ALTER TABLE "Order" ADD COLUMN "iyzicoCheckoutToken" TEXT;
ALTER TABLE "Order" ADD COLUMN "iyzicoPaidAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "iyzicoRawResult" JSONB;
