import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
// Entrega pública de solo lectura: una página de galería pide muchas imágenes
// a la vez, así que el tope es mucho más alto que el global (que sigue
// protegiendo del abuso masivo). En producción esto lo sirve el CDN, no el backend.
@Throttle({ default: { limit: 2400, ttl: 60_000 } })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get('galleries')
  @ApiOperation({ summary: 'Índice de colecciones públicas (todas, o solo las destacadas)' })
  listPublic(@Query('featured') featured?: string) {
    return this.media.listPublic({ featuredOnly: featured === 'true' });
  }

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
    // Estas imágenes están hechas para incrustarse desde el frontend (que en
    // desarrollo es otro origen: :3051 vs :3050) y desde un CDN. El
    // `Cross-Origin-Resource-Policy: same-origin` que pone helmet por defecto
    // lo impediría; el control de acceso de los privados es la firma HMAC de
    // la URL, no esta cabecera.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    object.stream.pipe(res);
  }
}
