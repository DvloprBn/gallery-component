import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { Public } from '../auth/decorators/public.decorator';

/** Forma de la respuesta de `GET /health`. */
interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: boolean; redis: boolean };
  timestamp: string;
}

/**
 * Endpoint de salud — lo consume Docker Compose / un balanceador para saber
 * si el proceso está vivo y si sus dependencias (PostgreSQL, Redis)
 * responden.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Comprueba la disponibilidad del servicio y de sus dependencias.
   *
   * No lanza: si una dependencia falla, la refleja en `checks` y baja
   * `status` a `"degraded"` (siempre responde 200 para no confundir un
   * problema de dependencia con un proceso caído).
   *
   * @returns Estado global (`ok` solo si PostgreSQL y Redis respondieron),
   *          el detalle por dependencia y la marca de tiempo ISO-8601.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado del servicio y sus dependencias' })
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      this.redis.raw
        .ping()
        .then((reply) => reply === 'PONG')
        .catch(() => false),
    ]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }
}
