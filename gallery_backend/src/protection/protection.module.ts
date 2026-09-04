import { Module } from '@nestjs/common';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { RightsMetadataService } from './rights-metadata.service';
import { WatermarkService } from './watermark.service';

/**
 * Fase 11 — protección de la obra: estampado de marca de agua y embebido de
 * metadatos de derechos (IPTC/XMP). Sin controller propio — `SiteController`
 * expone la configuración/subida y `ImagesService` los usa al procesar cada
 * imagen.
 */
@Module({
  imports: [MediaProcessingModule],
  providers: [WatermarkService, RightsMetadataService],
  exports: [WatermarkService, RightsMetadataService],
})
export class ProtectionModule {}
