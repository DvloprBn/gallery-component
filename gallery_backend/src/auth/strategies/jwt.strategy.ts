import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ACCESS_COOKIE } from '../cookies';
import type { AuthenticatedUser, JwtPayload } from '../jwt-payload.interface';

/**
 * Valida el access token en cada petición protegida.
 *
 * El token llega en la cookie httpOnly `access_token` (nunca en un header
 * que el JavaScript del navegador pueda leer). El algoritmo se fija explícito
 * a `HS256` — nunca se negocia con el cliente.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.[
            ACCESS_COOKIE
          ] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
      algorithms: ['HS256'],
    });
  }

  /**
   * Se ejecuta si la firma y la expiración del token son válidas.
   *
   * @param payload - El contenido ya verificado del JWT.
   * @returns El usuario, con rol y nivel **leídos en vivo de la base de
   *          datos** (no del token) — así desactivar la cuenta o cambiarle el
   *          rol surte efecto sin esperar a que el token caduque.
   * @throws UnauthorizedException si el token no es de tipo `access`, si la
   *         cuenta ya no existe o está desactivada.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.purpose !== 'access') {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.users.findUnique({
      where: { user_id: payload.sub },
      include: { roles: true },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException();
    }

    return {
      userId: user.user_id,
      email: user.email,
      roleName: user.roles.name,
      roleLevel: user.roles.level,
      mustChangePassword: user.must_change_password,
      totpEnabled: user.totp_enabled,
    };
  }
}
