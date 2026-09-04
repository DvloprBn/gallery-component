import { Module } from '@nestjs/common';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

/**
 * Fase 12 — licenciamiento. `PrismaService`, `MailService`, `SiteService` y
 * `StorageService` son globales, así que no hace falta importar sus módulos.
 */
@Module({
  controllers: [LicensingController],
  providers: [LicensingService],
})
export class LicensingModule {}
