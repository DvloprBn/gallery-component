import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateSiteDto } from './dto/site.dto';
import { SiteService } from './site.service';

/**
 * Identidad del sitio. Lectura pública (la consume la portada, "sobre mí" y
 * el chrome del frontend); escritura para roles administrativos.
 */
@ApiTags('site')
@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Ajustes públicos del sitio (nombre, bio, hero, contacto)' })
  get() {
    return this.site.get();
  }

  @Roles('admin', 'director', 'super')
  @Patch()
  @ApiOperation({ summary: 'Edita los ajustes del sitio' })
  update(@Body() dto: UpdateSiteDto) {
    return this.site.update(dto);
  }
}
