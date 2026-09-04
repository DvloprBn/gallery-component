-- CreateTable
CREATE TABLE "licenses" (
    "license_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "image_id" UUID NOT NULL,
    "licensee_name" VARCHAR(150) NOT NULL,
    "licensee_email" VARCHAR(255) NOT NULL,
    "intended_use" VARCHAR(20) NOT NULL,
    "price" VARCHAR(200),
    "conditions" VARCHAR(1000),
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("license_id")
);

-- CreateTable
CREATE TABLE "delivery_tokens" (
    "delivery_token_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_tokens_pkey" PRIMARY KEY ("delivery_token_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "licenses_request_id_key" ON "licenses"("request_id");

-- CreateIndex
CREATE INDEX "licenses_image_id_idx" ON "licenses"("image_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_tokens_token_hash_key" ON "delivery_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "delivery_tokens_license_id_idx" ON "delivery_tokens"("license_id");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "license_requests"("request_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tokens" ADD CONSTRAINT "delivery_tokens_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("license_id") ON DELETE CASCADE ON UPDATE CASCADE;
