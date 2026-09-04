import { Global, Module } from '@nestjs/common';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { ProtectionModule } from '../protection/protection.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';

/**
 * Expone `SiteService` de forma global (lo usa `contact` para el correo).
 * Importa `ProtectionModule` (marca de agua + metadatos de derechos) y
 * `MediaProcessingModule` (regenerar derivados) — los usa la regeneración de
 * la Fase 11.
 */
@Global()
@Module({
  imports: [ProtectionModule, MediaProcessingModule],
  controllers: [SiteController],
  providers: [SiteService],
  exports: [SiteService],
})
export class SiteModule {}
