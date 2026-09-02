import type { CookieOptions, Response } from 'express';

/** Nombre de la cookie que lleva el access token. */
export const ACCESS_COOKIE = 'access_token';
/** Nombre de la cookie que lleva el refresh token. */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Opciones base comunes a las dos cookies de sesión.
 *
 * - `httpOnly`: el JavaScript del navegador NO puede leerlas (mitiga el robo
 *   de sesión por XSS).
 * - `secure` en producción: solo viajan por HTTPS.
 * - `sameSite: 'lax'`: no se mandan en peticiones cruzadas de terceros, pero
 *   sí en navegaciones normales.
 * - `domain`: solo si `COOKIE_DOMAIN` está definida (para compartir sesión
 *   entre subdominios del mismo sitio en producción).
 */
function baseOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

/**
 * Fija las dos cookies de sesión en la respuesta.
 *
 * @param res - La respuesta de Express (`@Res({ passthrough: true })`).
 * @param accessToken - El JWT de acceso ya firmado.
 * @param refreshToken - El refresh token opaco (en claro; en la BD se guarda
 *        solo su hash).
 * @param accessMaxAgeMs - Vida de la cookie de acceso, en ms.
 * @param refreshMaxAgeMs - Vida de la cookie de refresh, en ms.
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  accessMaxAgeMs: number,
  refreshMaxAgeMs: number,
): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(),
    maxAge: accessMaxAgeMs,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(),
    maxAge: refreshMaxAgeMs,
  });
}

/**
 * Borra las dos cookies de sesión (logout, o revocación forzada).
 *
 * @param res - La respuesta de Express.
 */
export function clearAuthCookies(res: Response): void {
  const options = baseOptions();
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
