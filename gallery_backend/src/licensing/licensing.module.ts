import { Module } from '@nestjs/common';
import { ProtectionModule } from '../protection/protection.module';
import { DeliveryController } from './delivery.controller';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

/**
 * Fase 12 — licenciamiento. `PrismaService`, `MailService`, `SiteService` y
 * `StorageService` son globales, así que no hace falta importar sus módulos.
 * `ProtectionModule` sí hace falta — la entrega (12c) embebe el licenciatario
 * en los metadatos del archivo justo antes de servirlo.
 */
@Module({
  imports: [ProtectionModule],
  controllers: [LicensingController, DeliveryController],
  providers: [LicensingService],
})
export class LicensingModule {}
