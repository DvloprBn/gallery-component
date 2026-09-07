-- Fase 14b — Columnas de video en `media` (solo aditivo, todas anulables o con
-- default; las filas de foto existentes no se tocan).

-- `storage_key` pasa a ser anulable: un video tiene fila desde que se sube,
-- pero su master (la copia limpia) no existe hasta que termina el transcode.
ALTER TABLE "media" ALTER COLUMN "storage_key" DROP NOT NULL;

ALTER TABLE "media"
  ADD COLUMN "duration_ms"      INTEGER,
  ADD COLUMN "frame_rate"       DECIMAL(6,3),
  ADD COLUMN "video_codec"      VARCHAR(16),
  ADD COLUMN "audio_codec"      VARCHAR(16),
  ADD COLUMN "has_audio"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hls_manifest_key" TEXT,
  ADD COLUMN "poster_key"       TEXT,
  ADD COLUMN "processing_error" VARCHAR(500);
