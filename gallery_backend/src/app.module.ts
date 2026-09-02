import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { MailModule } from './mail/mail.module';
import { SecurityEventsModule } from './security-events/security-events.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { TwoFactorModule } from './two-factor/two-factor.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health/health.controller';

/**
 * Módulo raíz.
 *
 * Infraestructura (config validada, Prisma, Redis, correo, eventos de
 * seguridad) + identidad completa (auth, 2FA, roles, usuarios). Dos guards
 * globales, en este orden: `JwtAuthGuard` (exige sesión salvo `@Public()`) y
 * luego `RolesGuard` (aplica `@Roles()`). Los módulos de media llegan en la
 * Fase 3 — ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §1.6.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    RedisModule,
    MailModule,
    SecurityEventsModule,
    AuthModule,
    TwoFactorModule,
    RolesModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
