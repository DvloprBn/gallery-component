import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type albums as Album } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  generateOpaqueToken,
  sha256Hex,
} from '../common/utils/token.util';
import { slugifyWithSuffix } from '../common/utils/slug.util';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  CreateAlbumDto,
  CreateShareTokenDto,
  UpdateAlbumDto,
} from './dto/album.dto';

/** Roles que pueden ver/editar el álbum de cualquiera. */
const ADMIN_ROLES = new Set(['admin', 'director', 'super']);
/** Tamaño máximo del objeto `theme` serializado (defensa contra payloads enormes). */
const MAX_THEME_BYTES = 4000;

/**
 * CRUD de álbumes y de sus enlaces de compartir. La visibilidad
 * (`public`/`unlisted`/`private`), el layout y el `theme` viven en el álbum —
 * son la capa de personalización del proyecto.
 */
@Injectable()
export class AlbumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Álbumes del usuario autenticado, con su conteo de imágenes. */
  listMine(ownerId: string) {
    return this.prisma.albums.findMany({
      where: { owner_user_id: ownerId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
    });
  }

  /**
   * Un álbum concreto — solo si el actor es su dueño o tiene rol
   * administrativo. Devuelve 404 (no 403) cuando no hay acceso, para no
   * revelar que existe.
   */
  async getOwned(albumId: string, actor: AuthenticatedUser): Promise<Album> {
    const album = await this.prisma.albums.findUnique({
      where: { album_id: albumId },
    });
    if (!album || !this.canManage(album, actor)) {
      throw new NotFoundException('Álbum no encontrado.');
    }
    return album;
  }

  /** Crea un álbum. */
  async create(dto: CreateAlbumDto, ownerId: string): Promise<Album> {
    this.assertThemeSize(dto.theme);
    return this.prisma.albums.create({
      data: {
        owner_user_id: ownerId,
        title: dto.title.trim(),
        slug: slugifyWithSuffix(dto.title),
        description: dto.description?.trim() ?? null,
        visibility: dto.visibility ?? 'private',
        layout: dto.layout ?? 'masonry',
        featured: dto.featured ?? false,
        theme: (dto.theme ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Edita un álbum. */
  async update(
    albumId: string,
    dto: UpdateAlbumDto,
    actor: AuthenticatedUser,
  ): Promise<Album> {
    const album = await this.getOwned(albumId, actor);
    this.assertThemeSize(dto.theme);

    if (dto.coverMediaId) {
      const cover = await this.prisma.media.findUnique({
        where: { media_id: dto.coverMediaId },
      });
      if (!cover || cover.album_id !== album.album_id) {
        throw new BadRequestException('La portada debe ser una imagen de este álbum.');
      }
    }

    return this.prisma.albums.update({
      where: { album_id: albumId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.layout !== undefined ? { layout: dto.layout } : {}),
        ...(dto.theme !== undefined
          ? { theme: dto.theme as Prisma.InputJsonValue }
          : {}),
        ...(dto.coverMediaId !== undefined
          ? { cover_media_id: dto.coverMediaId }
          : {}),
        ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
      },
    });
  }

  /**
   * Borra un álbum y todo su contenido: primero los objetos del
   * almacenamiento (originales + derivados), luego las filas (la cascada de
   * Prisma se encarga de `media`/`media_variants`/`album_share_tokens`).
   */
  async remove(albumId: string, actor: AuthenticatedUser): Promise<void> {
    const album = await this.getOwned(albumId, actor);
    const rows = await this.prisma.media.findMany({
      where: { album_id: album.album_id },
      include: { variants: true },
    });

    for (const media of rows) {
      // `storage_key` puede ser null (video con transcode a medias);
      // `poster_key`/`hls_keys` solo existen en video.
      for (const key of [
        media.storage_key,
        media.poster_key,
        ...media.hls_keys,
        ...media.variants.map((v) => v.storage_key),
      ]) {
        if (key) await this.storage.remove(key);
      }
    }
    await this.prisma.albums.delete({ where: { album_id: album.album_id } });
  }

  /**
   * Lista los enlaces de compartir de un álbum (sin el token en claro — solo
   * su id, cuándo se creó, cuándo caduca y si está revocado).
   */
  async listShareTokens(albumId: string, actor: AuthenticatedUser) {
    const album = await this.getOwned(albumId, actor);
    const tokens = await this.prisma.album_share_tokens.findMany({
      where: { album_id: album.album_id },
      orderBy: { created_at: 'desc' },
      select: {
        share_token_id: true,
        created_at: true,
        expires_at: true,
        revoked: true,
      },
    });
    return tokens.map((t) => ({
      shareTokenId: t.share_token_id,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      revoked: t.revoked,
    }));
  }

  /** Crea un enlace de compartir para un álbum `unlisted`/`private`. */
  async createShareToken(
    albumId: string,
    dto: CreateShareTokenDto,
    actor: AuthenticatedUser,
  ): Promise<{ token: string; url: string; expiresAt: Date | null }> {
    const album = await this.getOwned(albumId, actor);
    const raw = generateOpaqueToken(24);
    const expiresAt = dto.expiresInMinutes
      ? new Date(Date.now() + dto.expiresInMinutes * 60_000)
      : null;

    await this.prisma.album_share_tokens.create({
      data: {
        album_id: album.album_id,
        token_hash: sha256Hex(raw),
        expires_at: expiresAt,
      },
    });

    const frontend = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '');
    return {
      token: raw,
      url: `${frontend}/g/${album.slug}?token=${raw}`,
      expiresAt,
    };
  }

  /** Revoca un enlace de compartir. */
  async revokeShareToken(
    albumId: string,
    shareTokenId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const album = await this.getOwned(albumId, actor);
    await this.prisma.album_share_tokens.updateMany({
      where: { share_token_id: shareTokenId, album_id: album.album_id },
      data: { revoked: true },
    });
  }

  /** ¿Puede este actor gestionar este álbum? (dueño o rol administrativo) */
  canManage(album: Album, actor: AuthenticatedUser): boolean {
    return (
      album.owner_user_id === actor.userId || ADMIN_ROLES.has(actor.roleName)
    );
  }

  /** Rechaza un `theme` cuyo JSON supere el tope de tamaño. */
  private assertThemeSize(theme: Record<string, unknown> | undefined): void {
    if (theme && JSON.stringify(theme).length > MAX_THEME_BYTES) {
      throw new BadRequestException('El tema es demasiado grande.');
    }
  }
}
