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
import { ReorderImagesDto, UpdateImageDto } from './dto/image.dto';
import { ImagesService, type UploadedImageFile } from './images.service';

/** Límite de tamaño por archivo — se corta en el interceptor, antes de bufferizar todo. */
const UPLOAD_MAX_BYTES = Number(
  process.env.UPLOAD_MAX_FILE_BYTES ?? 15_728_640,
);

@ApiTags('images')
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post('albums/:albumId/images')
  @ApiOperation({ summary: 'Sube una imagen a un álbum (pipeline de seguridad)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES } }),
  )
  upload(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    return this.images.upload(albumId, actor, file);
  }

  @Get('albums/:albumId/images')
  @ApiOperation({ summary: 'Lista las imágenes de un álbum (vista del Studio)' })
  listForAlbum(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.listForAlbum(albumId, actor);
  }

  @Post('albums/:albumId/images/reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reordena las imágenes de un álbum' })
  reorder(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @Body() dto: ReorderImagesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.reorder(albumId, actor, dto);
  }

  @Patch('images/:id')
  @ApiOperation({ summary: 'Edita alt / pie / orden de una imagen' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.update(id, actor, dto);
  }

  @Delete('images/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra una imagen' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.images.remove(id, actor);
  }
}
