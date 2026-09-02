import { createHmac } from 'node:crypto';
import { safeEqualHex } from '../common/utils/token.util';

/**
 * Firma HMAC para las URLs de vida corta del driver de disco.
 *
 * La URL privada queda como `/media/<key>?exp=<epoch>&sig=<hmac>`. El servidor
 * la genera solo tras verificar acceso; el cliente no puede fabricar una
 * firma válida porque no conoce `MEDIA_URL_SIGNING_SECRET`.
 */
function secret(): string {
  const value = process.env.MEDIA_URL_SIGNING_SECRET;
  if (!value) {
    throw new Error('MEDIA_URL_SIGNING_SECRET no está definida.');
  }
  return value;
}

/**
 * Calcula la firma para una clave + una expiración.
 *
 * @param key - Clave del objeto.
 * @param expEpochSeconds - Momento de caducidad (epoch en segundos).
 * @returns El HMAC-SHA256 en hexadecimal.
 */
export function signMediaKey(key: string, expEpochSeconds: number): string {
  return createHmac('sha256', secret())
    .update(`${key}.${expEpochSeconds}`)
    .digest('hex');
}

/**
 * Verifica una firma recibida.
 *
 * @param key - Clave del objeto.
 * @param exp - Valor de `exp` de la query (string).
 * @param sig - Valor de `sig` de la query (string hex).
 * @returns `true` solo si la firma es válida Y no ha caducado.
 */
export function verifyMediaSignature(
  key: string,
  exp: string | undefined,
  sig: string | undefined,
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) {
    return false;
  }
  const expEpoch = Number(exp);
  if (expEpoch * 1000 < Date.now()) {
    return false;
  }
  return safeEqualHex(sig, signMediaKey(key, expEpoch));
}
