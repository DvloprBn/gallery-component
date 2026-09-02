import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../jwt-payload.interface';

/**
 * Puerta gruesa por rol. Si un endpoint (o su controller) tiene `@Roles(...)`,
 * exige que el rol del usuario esté en esa lista.
 *
 * Registrado como `APP_GUARD` después de `JwtAuthGuard`, así siempre corre
 * con `req.user` ya poblado. La regla FINA (jerarquía de niveles, `max_count`)
 * no vive aquí — vive en el service del recurso.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * @param context - Contexto de la petición.
   * @returns `true` si no hay `@Roles()` en la ruta, o si el rol del usuario
   *          está permitido.
   * @throws ForbiddenException si hay `@Roles()` y el rol no está en la lista.
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user || !required.includes(user.roleName)) {
      throw new ForbiddenException('No tienes permiso para esta acción.');
    }
    return true;
  }
}
