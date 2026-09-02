-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "site_title" VARCHAR(120) NOT NULL DEFAULT 'Portafolio',
    "owner_name" VARCHAR(120) NOT NULL DEFAULT '',
    "tagline" VARCHAR(200) NOT NULL DEFAULT '',
    "bio" VARCHAR(600) NOT NULL DEFAULT '',
    "about_body" TEXT NOT NULL DEFAULT '',
    "contact_email" VARCHAR(255) NOT NULL DEFAULT '',
    "contact_intro" VARCHAR(600) NOT NULL DEFAULT '',
    "instagram" VARCHAR(200) NOT NULL DEFAULT '',
    "hero_image_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "message_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "ip_address" VARCHAR(45),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE INDEX "contact_messages_is_read_created_at_idx" ON "contact_messages"("is_read", "created_at");
