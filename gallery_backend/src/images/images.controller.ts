import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  BulkStatusDto,
  ReorderMediaDto,
  UpdateMediaDto,
} from './dto/media.dto';
import { ImagesService, type UploadedMediaFile } from './images.service';

/** Límite de tamaño por archivo — se corta en el interceptor, antes de bufferizar todo. */
const UPLOAD_MAX_BYTES = Number(
  process.env.UPLOAD_MAX_FILE_BYTES ?? 15_728_640,
);

@ApiTags('media')
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post('albums/:albumId/media')
  @ApiOperation({ summary: 'Sube un elemento (foto o video) a un álbum (pipeline de seguridad)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES } }),
  )
  upload(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    return this.images.upload(albumId, actor, file);
  }

  @Get('albums/:albumId/media')
  @ApiOperation({ summary: 'Lista el contenido de un álbum (vista del Studio)' })
  listForAlbum(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.listForAlbum(albumId, actor);
  }

  @Post('albums/:albumId/media/reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reordena el contenido de un álbum' })
  reorder(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @Body() dto: ReorderMediaDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.reorder(albumId, actor, dto);
  }

  @Post('albums/:albumId/media/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia el estado de curación de varios elementos' })
  setStatusBulk(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @Body() dto: BulkStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.setStatusBulk(albumId, actor, dto);
  }

  @Patch('media/:id')
  @ApiOperation({ summary: 'Edita alt / pie / orden de un elemento' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.update(id, actor, dto);
  }

  @Delete('media/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra un elemento' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.remove(id, actor);
  }
}
