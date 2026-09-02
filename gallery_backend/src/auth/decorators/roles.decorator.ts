import { SetMetadata } from '@nestjs/common';

/** Clave de metadatos donde `@Roles()` guarda la lista de roles permitidos. */
export const ROLES_KEY = 'roles';

/**
 * Restringe un endpoint (o un controller entero) a una lista de roles.
 *
 * Es la **puerta gruesa**: "¿este rol puede siquiera tocar este recurso?".
 * La regla fina de "¿a QUIÉN concretamente?" (jerarquía, `max_count`) vive en
 * el service, no aquí — mismo patrón que en `UsersService`/`RolesService`.
 *
 * @param roles - Nombres de rol permitidos (p. ej. `'admin', 'director', 'super'`).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
