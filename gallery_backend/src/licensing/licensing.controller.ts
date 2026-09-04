import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  QuoteLicenseRequestDto,
  SubmitLicenseRequestDto,
} from './dto/license-request.dto';
import { LicensingService } from './licensing.service';

/**
 * Solicitudes de licencia sobre fotos publicadas. Envío público, bandeja y
 * cotización para roles administrativos — emitir la licencia y entregar el
 * archivo firmado llegan en la Fase 12c.
 */
@ApiTags('licensing')
@Controller('license-requests')
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}

  @Public()
  @Post()
  @HttpCode(202)
  // Mismo criterio que /contact: un formulario no necesita más de unos pocos envíos por minuto.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Solicita licenciar una foto publicada' })
  submit(@Body() dto: SubmitLicenseRequestDto, @Req() req: Request) {
    return this.licensing.submit(dto, req.ip);
  }

  @Roles('admin', 'director', 'super')
  @Get()
  @ApiOperation({ summary: 'Bandeja de solicitudes de licencia' })
  list() {
    return this.licensing.list();
  }

  @Roles('admin', 'director', 'super')
  @Patch(':id')
  @ApiOperation({ summary: 'Cotiza una solicitud (precio, condiciones, vigencia de la oferta)' })
  quote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuoteLicenseRequestDto,
  ) {
    return this.licensing.quote(id, dto);
  }
}
