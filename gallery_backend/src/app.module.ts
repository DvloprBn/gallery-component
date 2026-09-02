import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthController } from './health/health.controller';

/**
 * Módulo raíz.
 *
 * En la Fase 1 solo cablea la infraestructura (configuración validada al
 * arranque, Prisma, Redis) y el endpoint de salud. Los módulos de dominio
 * (`auth`, `two-factor`, `roles`, `users`, `albums`, `images`,
 * `media-processing`, `storage`, `security-events`, `mail`) se agregan en
 * fases posteriores — ver DOCUMENTO_VIVO_ARQUITECTURA.md §1.6.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
