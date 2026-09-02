import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { MailService } from '../mail/mail.service';

/** Tipos de evento de seguridad que este servicio cuenta. */
export type SecurityEventType =
  | 'login_bruteforce'
  | 'twofactor_bruteforce'
  | 'refresh_token_reuse';

/** Política de conteo por tipo: cuántos intentos fallidos y en qué ventana. */
const POLICIES: Record<
  SecurityEventType,
  { limit: number; windowSeconds: number }
> = {
  login_bruteforce: { limit: 10, windowSeconds: 900 },
  twofactor_bruteforce: { limit: 5, windowSeconds: 900 },
  refresh_token_reuse: { limit: 1, windowSeconds: 900 },
};

/**
 * Detección de fuerza bruta y abuso, con conteo en Redis (ventana fija) y
 * una fila real en `security_events` solo cuando se cruza el umbral — así la
 * tabla registra incidentes, no ruido.
 *
 * Mismo mecanismo para los tres puntos reales de fuerza bruta del sistema:
 * login, verificación de 2FA, y reuso de un refresh token robado.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Huella estable de un intento: identifica "el mismo actor" sin guardar el
   * identificador en claro.
   *
   * @param type - Tipo de evento.
   * @param identifier - Correo, `user_id`, o lo que aplique al caso.
   * @param ip - IP de origen (puede venir vacía).
   * @returns 64 hex.
   */
  private fingerprint(
    type: SecurityEventType,
    identifier: string,
    ip: string | undefined,
  ): string {
    return createHash('sha256')
      .update(`${type}|${identifier.toLowerCase()}|${ip ?? ''}`)
      .digest('hex');
  }

  private redisKey(fingerprint: string): string {
    return `bf:${fingerprint}`;
  }

  /**
   * Corta la petición ANTES de procesarla si ese actor ya agotó su cuota.
   *
   * @param type - Tipo de evento.
   * @param identifier - Correo o `user_id`.
   * @param ip - IP de origen.
   * @throws HttpException 429 (429) si el contador ya alcanzó el límite.
   */
  async assertNotBlocked(
    type: SecurityEventType,
    identifier: string,
    ip: string | undefined,
  ): Promise<void> {
    const key = this.redisKey(this.fingerprint(type, identifier, ip));
    const raw = await this.redis.raw.get(key);
    const count = raw ? Number(raw) : 0;
    if (count >= POLICIES[type].limit) {
      throw new HttpException(
        'Demasiados intentos. Espera unos minutos antes de volver a probar.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Registra un intento fallido. Al cruzar el umbral, crea/actualiza la fila
   * de `security_events` y manda una alerta por correo.
   *
   * @param type - Tipo de evento.
   * @param identifier - Correo o `user_id`.
   * @param ip - IP de origen.
   * @param userAgent - User-Agent de origen (opcional).
   */
  async recordFailure(
    type: SecurityEventType,
    identifier: string,
    ip: string | undefined,
    userAgent?: string,
  ): Promise<void> {
    const fingerprint = this.fingerprint(type, identifier, ip);
    const { limit, windowSeconds } = POLICIES[type];
    const attempts = await this.redis.incrementWithTtl(
      this.redisKey(fingerprint),
      windowSeconds,
    );

    if (attempts < limit) {
      return;
    }

    const existing = await this.prisma.security_events.findUnique({
      where: { fingerprint },
    });

    if (existing) {
      await this.prisma.security_events.update({
        where: { fingerprint },
        data: {
          attempts,
          occurrence_count: { increment: 1 },
          last_seen_at: new Date(),
          status: 'nuevo',
        },
      });
    } else {
      await this.prisma.security_events.create({
        data: {
          fingerprint,
          type,
          identifier,
          ip_address: ip ?? null,
          user_agent: userAgent ?? null,
          attempts,
        },
      });
      await this.mail.send(
        process.env.MAIL_FROM_ADDRESS ?? 'no-reply@example.com',
        `[Galería] Alerta de seguridad: ${type}`,
        `<p>Se cruzó el umbral de <strong>${type}</strong> (${attempts} intentos) ` +
          `para <code>${identifier}</code> desde IP <code>${ip ?? 'desconocida'}</code>.</p>`,
      );
      this.logger.warn(
        `Umbral cruzado: ${type} identifier=${identifier} ip=${ip ?? '-'} attempts=${attempts}`,
      );
    }
  }

  /**
   * Limpia el contador tras un intento exitoso (login correcto, 2FA correcto).
   *
   * @param type - Tipo de evento.
   * @param identifier - Correo o `user_id`.
   * @param ip - IP de origen.
   */
  async reset(
    type: SecurityEventType,
    identifier: string,
    ip: string | undefined,
  ): Promise<void> {
    await this.redis.raw.del(this.redisKey(this.fingerprint(type, identifier, ip)));
  }
}
