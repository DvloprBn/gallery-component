-- AlterTable: estado de curación por imagen.
-- Las subidas NUEVAS entran como 'draft' (se cura después); todo lo que ya
-- estaba subido se marca 'published' para no ocultar nada que ya se veía.
ALTER TABLE "images" ADD COLUMN     "status" VARCHAR(16) NOT NULL DEFAULT 'draft';
UPDATE "images" SET "status" = 'published';

-- CreateIndex
CREATE INDEX "images_album_id_status_idx" ON "images"("album_id", "status");
