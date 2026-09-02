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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { AlbumsService } from './albums.service';
import {
  CreateAlbumDto,
  CreateShareTokenDto,
  UpdateAlbumDto,
} from './dto/album.dto';

/**
 * Gestión de álbumes por su dueño. Requiere sesión (guard global); no exige
 * ningún rol — cada quien administra los suyos. Los roles administrativos
 * pueden además tocar los de cualquiera (lo aplica `AlbumsService`).
 */
@ApiTags('albums')
@Controller('albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  @ApiOperation({ summary: 'Mis álbumes' })
  listMine(@CurrentUser('userId') userId: string) {
    return this.albums.listMine(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un álbum (visibilidad, layout y tema de una vez)' })
  create(@Body() dto: CreateAlbumDto, @CurrentUser('userId') userId: string) {
    return this.albums.create(dto, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un álbum mío (o de cualquiera, si soy admin)' })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.albums.getOwned(id, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita un álbum' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlbumDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.albums.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra un álbum y todo su contenido' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.albums.remove(id, actor);
  }

  @Post(':id/share-tokens')
  @ApiOperation({ summary: 'Crea un enlace de compartir (con caducidad opcional)' })
  createShareToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateShareTokenDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.albums.createShareToken(id, dto, actor);
  }

  @Delete(':id/share-tokens/:tokenId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoca un enlace de compartir' })
  revokeShareToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.albums.revokeShareToken(id, tokenId, actor);
  }
}
