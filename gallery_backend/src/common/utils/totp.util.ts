import { authenticator } from 'otplib';

/**
 * TOTP (RFC 6238) — el segundo factor de autenticación. El mismo algoritmo
 * que Google Authenticator / Authy / 1Password: un secreto compartido + el
 * reloj generan un código de 6 dígitos que cambia cada 30 segundos.
 *
 * `window: 1` acepta también el código del intervalo anterior y el siguiente
 * (±30 s) para tolerar relojes ligeramente desfasados — es el margen estándar,
 * no una relajación de seguridad.
 */
authenticator.options = { step: 30, digits: 6, window: 1 };

/**
 * Genera un secreto TOTP nuevo.
 *
 * @returns El secreto en base32 (el formato que esperan las apps de
 *          autenticación). Debe cifrarse antes de guardarse — ver
 *          `crypto.util.ts`.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Construye la URL `otpauth://` que se codifica en el QR que escanea el
 * usuario al activar 2FA.
 *
 * @param secret - El secreto en base32 de {@link generateTotpSecret}.
 * @param accountName - Identifica la cuenta dentro de la app (se usa el correo).
 * @param issuer - Nombre del servicio, se muestra en la app de autenticación.
 * @returns La URI `otpauth://totp/...` lista para pasar a un generador de QR.
 */
export function buildOtpAuthUrl(
  secret: string,
  accountName: string,
  issuer: string,
): string {
  return authenticator.keyuri(accountName, issuer, secret);
}

/**
 * Verifica un código TOTP contra un secreto.
 *
 * @param token - Los 6 dígitos que tecleó el usuario.
 * @param secret - El secreto en base32 (ya descifrado) de esa cuenta.
 * @returns `true` solo si el código corresponde al secreto y está dentro de
 *          la ventana de tiempo aceptada. Nunca lanza — un token con formato
 *          raro simplemente da `false`.
 */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}
