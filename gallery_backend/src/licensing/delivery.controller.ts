import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { LicensingService } from './licensing.service';

/**
 * Entrega del archivo licenciado (Fase 12c) — el enlace que llega por correo
 * al aceptar una solicitud. Ruta pública a propósito: el control de acceso
 * no es una sesión, es el token de un solo uso en la propia URL.
 */
@ApiTags('licensing')
@Controller('deliveries')
export class DeliveryController {
  constructor(private readonly licensing: LicensingService) {}

  @Public()
  @Get(':token')
  @ApiOperation({
    summary: 'Descarga el archivo licenciado — el enlace se consume en la primera descarga',
  })
  async serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const object = await this.licensing.consumeDelivery(token);
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Length', object.bytes);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', `attachment; filename="${object.filename}"`);
    object.stream.pipe(res);
  }
}
