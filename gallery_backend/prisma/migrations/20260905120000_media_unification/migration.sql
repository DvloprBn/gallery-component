-- Fase 14a — Unificación `images` -> `media` (preparación para soportar video).
--
-- Es un RENOMBRADO, no un recreado: cada `ALTER TABLE ... RENAME` conserva los
-- datos, las secuencias y los defaults. Se renombran también los índices y las
-- llaves foráneas para que coincidan con los nombres que Prisma deriva del
-- nuevo modelo (si no, la siguiente `migrate` los vería como "drift" y los
-- recrearía). Al final se añade el discriminador `kind` (todo lo existente es
-- 'photo').

-- 1. Tablas
ALTER TABLE "images" RENAME TO "media";
ALTER TABLE "image_variants" RENAME TO "media_variants";

-- 2. Columnas de id / FK
ALTER TABLE "media" RENAME COLUMN "image_id" TO "media_id";
ALTER TABLE "media_variants" RENAME COLUMN "image_id" TO "media_id";
ALTER TABLE "license_requests" RENAME COLUMN "image_id" TO "media_id";
ALTER TABLE "licenses" RENAME COLUMN "image_id" TO "media_id";
ALTER TABLE "albums" RENAME COLUMN "cover_image_id" TO "cover_media_id";
ALTER TABLE "albums" RENAME COLUMN "image_count" TO "media_count";
ALTER TABLE "site_settings" RENAME COLUMN "hero_image_id" TO "hero_media_id";

-- 3. Primary keys
ALTER INDEX "images_pkey" RENAME TO "media_pkey";
ALTER INDEX "image_variants_pkey" RENAME TO "media_variants_pkey";

-- 4. Índices únicos y normales
ALTER INDEX "images_storage_key_key" RENAME TO "media_storage_key_key";
ALTER INDEX "images_album_id_idx" RENAME TO "media_album_id_idx";
ALTER INDEX "images_owner_user_id_idx" RENAME TO "media_owner_user_id_idx";
ALTER INDEX "images_album_id_status_idx" RENAME TO "media_album_id_status_idx";
ALTER INDEX "image_variants_storage_key_key" RENAME TO "media_variants_storage_key_key";
ALTER INDEX "image_variants_image_id_idx" RENAME TO "media_variants_media_id_idx";
ALTER INDEX "image_variants_image_id_label_format_key" RENAME TO "media_variants_media_id_label_format_key";
ALTER INDEX "license_requests_image_id_idx" RENAME TO "license_requests_media_id_idx";
ALTER INDEX "licenses_image_id_idx" RENAME TO "licenses_media_id_idx";

-- 5. Foreign keys (solo cambia el nombre del constraint; la relación es la misma)
ALTER TABLE "media" RENAME CONSTRAINT "images_album_id_fkey" TO "media_album_id_fkey";
ALTER TABLE "media" RENAME CONSTRAINT "images_owner_user_id_fkey" TO "media_owner_user_id_fkey";
ALTER TABLE "media_variants" RENAME CONSTRAINT "image_variants_image_id_fkey" TO "media_variants_media_id_fkey";
ALTER TABLE "license_requests" RENAME CONSTRAINT "license_requests_image_id_fkey" TO "license_requests_media_id_fkey";
ALTER TABLE "licenses" RENAME CONSTRAINT "licenses_image_id_fkey" TO "licenses_media_id_fkey";

-- 6. Discriminador de tipo de media
CREATE TYPE "media_kind" AS ENUM ('photo', 'video');
ALTER TABLE "media" ADD COLUMN "kind" "media_kind" NOT NULL DEFAULT 'photo';
