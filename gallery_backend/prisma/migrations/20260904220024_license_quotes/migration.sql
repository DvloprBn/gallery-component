-- AlterTable
ALTER TABLE "license_requests" ADD COLUMN     "quote_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "quoted_at" TIMESTAMPTZ(6),
ADD COLUMN     "quoted_conditions" VARCHAR(1000),
ADD COLUMN     "quoted_price" VARCHAR(200);
