import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service';

/**
 * Crea un único cliente de Redis a partir de `REDIS_URL` y lo expone de
 * forma global a través de `RedisService`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const logger = new Logger('RedisModule');
        const url = process.env.REDIS_URL;
        if (!url) {
          throw new Error('REDIS_URL no está definida.');
        }
        const client = new Redis(url, { maxRetriesPerRequest: 3 });
        client.on('connect', () => logger.log('Conexión a Redis establecida.'));
        client.on('error', (err: Error) =>
          logger.error(`Error de Redis: ${err.message}`),
        );
        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
