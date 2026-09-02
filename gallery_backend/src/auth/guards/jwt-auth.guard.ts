import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global de autenticación. Exige un access token válido en TODA ruta,
 * salvo las marcadas con `@Public()`.
 *
 * Registrado como `APP_GUARD` en `AppModule`, así ninguna ruta nueva queda
 * abierta por olvido — hay que marcarla `@Public()` a propósito.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * @param context - Contexto de la petición.
   * @returns `true` si la ruta es `@Public()`; en otro caso delega en la
   *          estrategia JWT (que lanza 401 si el token falta o es inválido).
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
