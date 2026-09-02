import {
  Body,
  Controller,
  Delete,
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
import { MarkMessageDto, SubmitContactDto } from './dto/contact.dto';
import { ContactService } from './contact.service';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @Post()
  @HttpCode(202)
  // Un formulario de contacto no necesita más de unos pocos envíos por minuto.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envía un mensaje de contacto' })
  submit(@Body() dto: SubmitContactDto, @Req() req: Request) {
    return this.contact.submit(dto, req.ip);
  }

  @Roles('admin', 'director', 'super')
  @Get('messages')
  @ApiOperation({ summary: 'Bandeja de mensajes de contacto' })
  list() {
    return this.contact.list();
  }

  @Roles('admin', 'director', 'super')
  @Patch('messages/:id')
  @ApiOperation({ summary: 'Marca un mensaje como leído / no leído' })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkMessageDto,
  ) {
    return this.contact.markRead(id, dto.read);
  }

  @Roles('admin', 'director', 'super')
  @Delete('messages/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra un mensaje de contacto' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.remove(id);
  }
}
