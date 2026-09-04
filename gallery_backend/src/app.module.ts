import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { StorageModule } from './storage/storage.module';
import { MediaProcessingModule } from './media-processing/media-processing.module';
import { AlbumsModule } from './albums/albums.module';
import { ImagesModule } from './images/images.module';
import { MediaModule } from './media/media.module';
import { SiteModule } from './site/site.module';
import { ContactModule } from './contact/contact.module';
import { LicensingModule } from './licensing/licensing.module';
import { HealthController } from './health/health.controller';

/**
 * Módulo raíz.
 *
 * Infraestructura (config validada, Prisma, Redis, correo, eventos de
 * seguridad, almacenamiento) + identidad (auth, 2FA, roles, usuarios) + media
 * (procesamiento de imagen, álbumes, imágenes, entrega pública).
 *
 * Tres guards globales, en este orden: `ThrottlerGuard` (tope general de
 * peticiones por IP — corta un flood antes de gastar trabajo), `JwtAuthGuard`
 * (exige sesión salvo `@Public()`) y `RolesGuard` (aplica `@Roles()`). Los
 * límites finos de fuerza bruta (login, 2FA, subida) viven por debajo de este,
 * en `SecurityEventsService`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Tope general: 600 peticiones por minuto y por IP. Muy por encima del
    // uso normal (navegar una galería), suficiente para frenar abuso.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
    RedisModule,
    MailModule,
    SecurityEventsModule,
    StorageModule,
    MediaProcessingModule,
    AuthModule,
    TwoFactorModule,
    RolesModule,
    UsersModule,
    AlbumsModule,
    ImagesModule,
    MediaModule,
    SiteModule,
    ContactModule,
    LicensingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
