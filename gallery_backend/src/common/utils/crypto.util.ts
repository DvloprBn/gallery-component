import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico autenticado para secretos que el servidor necesita poder
 * **leer de vuelta** (a diferencia de una contraseña, que solo se hashea).
 * El único uso hoy es el secreto TOTP de 2FA: para verificar el código de 6
 * dígitos de la app del usuario hay que recalcularlo, así que el secreto se
 * guarda cifrado, no hasheado.
 *
 * Algoritmo: AES-256-GCM. GCM añade un `authTag` que detecta cualquier
 * manipulación del texto cifrado — si un byte cambia, el descifrado falla en
 * vez de devolver basura.
 */
const ALGORITHM = 'aes-256-gcm';
/** GCM recomienda un IV de 96 bits (12 bytes). */
const IV_BYTES = 12;

/**
 * Deriva la llave de 32 bytes desde `TOTP_ENCRYPTION_KEY` (64 caracteres hex).
 *
 * @returns La llave como `Buffer` de 32 bytes.
 * @throws Error si la variable no existe o no son 64 hex — mismo criterio que
 *         `validateEnv`, revalidado aquí porque esta función también corre en
 *         los tests, fuera del arranque de Nest.
 */
function getKey(): Buffer {
  const hex = process.env.TOTP_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'TOTP_ENCRYPTION_KEY debe ser 64 caracteres hexadecimales (32 bytes).',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Cifra un texto plano con AES-256-GCM.
 *
 * @param plaintext - El secreto a proteger (p. ej. el secreto TOTP en base32).
 * @returns Una sola cadena base64 con `iv || authTag || ciphertext`
 *          concatenados — lista para guardar en una columna de texto.
 * @throws Error si `TOTP_ENCRYPTION_KEY` es inválida.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Descifra lo que produjo {@link encryptSecret}.
 *
 * @param payload - La cadena base64 `iv || authTag || ciphertext`.
 * @returns El texto plano original.
 * @throws Error si el `authTag` no valida (el dato fue manipulado o la llave
 *         no es la misma con la que se cifró) o si el formato es inválido.
 */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length <= IV_BYTES + 16) {
    throw new Error('Payload cifrado con formato inválido.');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = raw.subarray(IV_BYTES + 16);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
