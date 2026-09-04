-- CreateTable
CREATE TABLE "license_requests" (
    "request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "image_id" UUID NOT NULL,
    "requester_name" VARCHAR(150) NOT NULL,
    "requester_email" VARCHAR(255) NOT NULL,
    "intended_use" VARCHAR(20) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "budget" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE INDEX "license_requests_status_created_at_idx" ON "license_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "license_requests_image_id_idx" ON "license_requests"("image_id");

-- AddForeignKey
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;
