import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Genera un token opaco de alta entropía, seguro para URL.
 *
 * Se usa para el refresh token, los tokens de restablecer contraseña y los
 * enlaces de compartir álbumes: valores que el servidor entrega una vez y
 * después solo compara.
 *
 * @param bytes - Bytes de aleatoriedad (32 = 256 bits, el default).
 * @returns Cadena base64url sin relleno.
 */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash SHA-256 en hexadecimal.
 *
 * Es el hash con el que se guardan en la base de datos los tokens opacos
 * (`refresh_tokens.token_hash`, `password_reset_tokens.token_hash`): permite
 * un índice único y una búsqueda O(1), y como el token original tiene 256
 * bits de entropía no hace falta el coste de bcrypt (que además no se puede
 * indexar). bcrypt se reserva para lo que sí es adivinable — contraseñas y
 * códigos de recuperación.
 *
 * @param input - El token en claro.
 * @returns Los 64 caracteres hex del digest.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compara dos cadenas hex en tiempo constante (evita filtrar información por
 * el tiempo que tarda la comparación).
 *
 * @param a - Primer valor hex.
 * @param b - Segundo valor hex.
 * @returns `true` si son idénticos; `false` si difieren o no miden lo mismo.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
