-- Fase 14c — claves HLS por elemento (para poder limpiar los segmentos al borrar).
ALTER TABLE "media" ADD COLUMN "hls_keys" TEXT[] NOT NULL DEFAULT '{}';
