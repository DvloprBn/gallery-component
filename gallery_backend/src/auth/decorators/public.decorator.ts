import { SetMetadata } from '@nestjs/common';

/** Clave de metadatos que marca un endpoint como abierto (sin sesión). */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público: el `JwtAuthGuard` global lo deja pasar sin
 * exigir sesión. Se usa en registro, los pasos de login, y recuperación de
 * contraseña.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
