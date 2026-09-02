import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MediaService } from './media.service';

/**
 * Entrega pública: la galería de un álbum por su slug y el servido de
 * archivos del driver de disco. Ambas rutas son `@Public()` — el control de
 * acceso lo hace `MediaService` según la visibilidad del álbum.
 */
@ApiTags('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get('g/:slug')
  @ApiOperation({ summary: 'Galería pública de un álbum (por slug)' })
  getGallery(
    @Param('slug') slug: string,
    @Query('token') token?: string,
  ) {
    return this.media.getGallery(slug, token);
  }

  @Public()
  @Get('media/:key')
  @ApiOperation({ summary: 'Sirve un archivo (driver de disco); privados requieren firma' })
  async serve(
    @Param('key') key: string,
    @Res() res: Response,
    @Query('exp') exp?: string,
    @Query('sig') sig?: string,
  ): Promise<void> {
    const object = await this.media.serveObject(key, exp, sig);
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Length', object.bytes);
    res.setHeader('Cache-Control', object.cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    object.stream.pipe(res);
  }
}
