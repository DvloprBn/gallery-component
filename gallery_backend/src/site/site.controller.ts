import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateSiteDto } from './dto/site.dto';
import { SiteService } from './site.service';

/** Tope de subida del logo de marca de agua — no es una foto, no hace falta más. */
const WATERMARK_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Identidad del sitio. Lectura pública (la consume la portada, "sobre mí" y
 * el chrome del frontend); escritura para roles administrativos. Incluye la
 * configuración de **marca de agua** y **derechos por defecto** (Fase 11).
 */
@ApiTags('site')
@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Ajustes públicos del sitio (nombre, bio, hero, contacto, marca de agua, derechos)' })
  get() {
    return this.site.get();
  }

  @Roles('admin', 'director', 'super')
  @Patch()
  @ApiOperation({ summary: 'Edita los ajustes del sitio' })
  update(@Body() dto: UpdateSiteDto) {
    return this.site.update(dto);
  }

  @Roles('admin', 'director', 'super')
  @Post('watermark')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: WATERMARK_MAX_BYTES } }),
  )
  @ApiOperation({ summary: 'Sube (o reemplaza) el logo de la marca de agua' })
  uploadWatermark(
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    return this.site.uploadWatermarkAsset(file);
  }

  @Roles('admin', 'director', 'super')
  @Delete('watermark')
  @ApiOperation({ summary: 'Quita el logo subido (vuelve al texto de respaldo)' })
  removeWatermark() {
    return this.site.removeWatermarkAsset();
  }

  @Roles('admin', 'director', 'super')
  @Post('watermark/regenerate')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Arranca (en segundo plano) rehacer los derivados públicos con la marca y los derechos vigentes',
  })
  regenerate() {
    return this.site.startWatermarkRegeneration();
  }

  @Roles('admin', 'director', 'super')
  @Get('watermark/regenerate')
  @ApiOperation({ summary: 'Progreso de la última regeneración lanzada' })
  regenerationStatus() {
    return this.site.getWatermarkRegenerationStatus();
  }
}
