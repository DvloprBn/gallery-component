/**
 * Prepara el entorno para los `*.spec.ts` de integración (los que hablan con
 * el Postgres real de desarrollo).
 *
 * - Dentro del contenedor `npm test` ya trae `DATABASE_URL` apuntando a
 *   `gallery_db:5432` — no se toca.
 * - Corriendo desde el host, carga `../.env` y reescribe el host del
 *   contenedor a `localhost:5438` (el puerto publicado del Postgres de dev).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.DATABASE_URL) {
  const envPath = join(__dirname, '..', '..', '.env');
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(rawLine.trim());
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  }
  if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      '@gallery_db:5432',
      '@localhost:5438',
    );
  }
}

// Valores por defecto para las utilidades que leen del entorno en los tests
// puros (no dependen de nada real).
process.env.TOTP_ENCRYPTION_KEY ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.MEDIA_URL_SIGNING_SECRET ??= 'test-media-signing-secret-not-real';
