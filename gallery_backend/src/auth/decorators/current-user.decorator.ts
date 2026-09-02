import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../jwt-payload.interface';

/**
 * Inyecta el usuario autenticado (lo que `JwtStrategy.validate` puso en
 * `req.user`) en un parámetro del handler.
 *
 * @param field - Si se pasa el nombre de un campo de `AuthenticatedUser`,
 *                devuelve solo ese valor; si se omite, devuelve el objeto
 *                completo.
 * @returns El usuario autenticado o el campo pedido; `undefined` si la ruta
 *          no está protegida.
 *
 * @example
 * ```ts
 * \@Get('me')
 * me(\@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * \@Get('mis-albumes')
 * mine(\@CurrentUser('userId') userId: string) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    return field ? user?.[field] : user;
  },
);
