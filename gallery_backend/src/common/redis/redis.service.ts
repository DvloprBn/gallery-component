import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Token de inyección del cliente ioredis crudo. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Acceso a Redis para toda la aplicación.
 *
 * En este proyecto Redis se usa para rate limiting y para el conteo con
 * ventana deslizante de la detección de fuerza bruta (login, 2FA, abuso de
 * subida). Nunca como almacén de datos de negocio — eso vive en PostgreSQL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** El cliente ioredis subyacente, para operaciones directas. */
  get raw(): Redis {
    return this.client;
  }

  /**
   * Incrementa un contador y le fija una expiración la PRIMERA vez que se
   * crea — la primitiva detrás del rate limiting con ventana fija.
   *
   * @param key - Clave del contador (p. ej. `rl:login:<ip>`).
   * @param windowSeconds - Segundos de vida de la ventana.
   * @returns El valor del contador tras incrementar (1 en la primera llamada
   *          de la ventana).
   */
  async incrementWithTtl(key: string, windowSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count;
  }

  /** Cierra la conexión a Redis al apagar la aplicación. */
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
