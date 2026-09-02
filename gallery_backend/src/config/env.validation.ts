/**
 * Variables de entorno obligatorias para que el backend arranque. Si falta
 * una, el proceso debe fallar de inmediato con un mensaje claro — nunca
 * arrancar "a medias" y descubrir el hueco más tarde en runtime.
 */
const REQUIRED_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'TOTP_ENCRYPTION_KEY',
  'MEDIA_URL_SIGNING_SECRET',
  'STORAGE_DRIVER',
  'ALLOWED_ORIGINS',
  'FRONTEND_URL',
  'RESEND_API_KEY',
  'MAIL_FROM_ADDRESS',
] as const;

/**
 * Valida el entorno al arranque (lo invoca `ConfigModule.forRoot({ validate })`).
 *
 * @param config - Mapa crudo de variables de entorno (equivale a `process.env`).
 * @returns El mismo mapa recibido, ya validado (Nest lo usa como fuente de
 *          configuración).
 * @throws Error si falta alguna variable de `REQUIRED_KEYS`; si
 *         `TOTP_ENCRYPTION_KEY` no son 64 caracteres hex (32 bytes, requisito
 *         de AES-256-GCM); o si `STORAGE_DRIVER=cloudinary` sin las tres
 *         credenciales de Cloudinary.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno obligatorias sin valor: ${missing.join(', ')}`,
    );
  }

  const totpKey = String(config.TOTP_ENCRYPTION_KEY);
  if (!/^[0-9a-fA-F]{64}$/.test(totpKey)) {
    throw new Error(
      'TOTP_ENCRYPTION_KEY debe ser exactamente 64 caracteres hexadecimales ' +
        '(32 bytes). Genera uno con: openssl rand -hex 32',
    );
  }

  if (config.STORAGE_DRIVER === 'cloudinary') {
    const cloudinaryKeys = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ];
    const missingCloudinary = cloudinaryKeys.filter(
      (key) => !config[key] || String(config[key]).trim() === '',
    );
    if (missingCloudinary.length > 0) {
      throw new Error(
        `STORAGE_DRIVER=cloudinary pero faltan: ${missingCloudinary.join(', ')}`,
      );
    }
  } else if (config.STORAGE_DRIVER !== 'disk') {
    throw new Error(
      `STORAGE_DRIVER debe ser "disk" o "cloudinary" (recibido: "${String(
        config.STORAGE_DRIVER,
      )}")`,
    );
  }

  return config;
}
