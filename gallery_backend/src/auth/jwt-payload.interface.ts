/**
 * Para qué sirve un token firmado por este backend.
 *  - `access`         → sesión real: da acceso a los endpoints protegidos.
 *  - `2fa_challenge`  → prueba de vida de corta duración entre el paso de
 *                       contraseña y el paso de 2FA. NUNCA es una sesión.
 */
export type TokenPurpose = 'access' | '2fa_challenge';

/** Contenido de un JWT emitido por este backend. */
export interface JwtPayload {
  /** `user_id` (UUID). */
  sub: string;
  purpose: TokenPurpose;
}

/**
 * Lo que queda en `req.user` tras validar un access token.
 *
 * Todos estos campos se **leen en vivo de la base de datos** en
 * `JwtStrategy.validate` — nunca del payload firmado — para que revocar un
 * rol o desactivar una cuenta surta efecto de inmediato, sin esperar a que
 * caduque el token.
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  roleName: string;
  roleLevel: number;
  mustChangePassword: boolean;
}
