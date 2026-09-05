import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { basename } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AlbumsService } from '../albums/albums.service';
import { ImagePipelineService } from '../media-processing/image-pipeline.service';
import type { EmbeddableFormat } from '../protection/rights-metadata.service';
import { RightsMetadataService } from '../protection/rights-metadata.service';
import { resolveRights, sanitizeRightsPartial } from '../protection/rights.util';
import { WatermarkService } from '../protection/watermark.service';
import { SiteService } from '../site/site.service';
import { StorageService } from '../storage/storage.service';
import type { MediaVisibility } from '../storage/storage-driver.interface';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  BulkStatusDto,
  ReorderMediaDto,
  UpdateMediaDto,
} from './dto/media.dto';

/** Un archivo subido (memory storage de multer). */
export interface UploadedMediaFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Subidas por usuario y hora antes de responder 429. Configurable con
 * `UPLOAD_MAX_UPLOADS_PER_HOUR` (por defecto 120) — se sube en desarrollo para
 * poder sembrar la demo, se deja bajo en producción.
 */
const MAX_UPLOADS_PER_HOUR = Math.max(
  1,
  Number(process.env.UPLOAD_MAX_UPLOADS_PER_HOUR) || 120,
);

/**
 * Subida de imágenes (pipeline de seguridad + almacenamiento + persistencia),
 * reordenado, edición de metadatos y borrado.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pipeline: ImagePipelineService,
    private readonly redis: RedisService,
    private readonly albums: AlbumsService,
    private readonly watermark: WatermarkService,
    private readonly metadata: RightsMetadataService,
    private readonly site: SiteService,
  ) {}

  /**
   * Sube una imagen a un álbum.
   *
   * Flujo: rate limit → `pipeline.process` (valida por contenido, re-codifica,
   * quita EXIF, genera derivados + placeholder) → sube original y derivados al
   * almacenamiento → persiste `media` + `media_variants` + `media_count` en
   * una transacción. Si algo falla tras subir objetos, se limpian.
   *
   * @param albumId - Álbum destino.
   * @param actor - Usuario autenticado (debe ser dueño del álbum o admin).
   * @param file - El archivo subido.
   * @returns La imagen creada, con sus URLs de entrega.
   * @throws HttpException 429 si se superó el límite de subidas por hora.
   * @throws BadRequestException si el contenido no es una imagen admitida.
   */
  async upload(
    albumId: string,
    actor: AuthenticatedUser,
    file: UploadedMediaFile,
  ) {
    const uploads = await this.redis.incrementWithTtl(
      `ul:${actor.userId}`,
      3600,
    );
    if (uploads > MAX_UPLOADS_PER_HOUR) {
      throw new HttpException(
        'Has subido demasiadas imágenes en la última hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const album = await this.albums.getOwned(albumId, actor);
    const visibility = album.visibility as MediaVisibility;

    const processed = await this.pipeline.process(file.buffer);

    // Fase 11 — protección: se resuelve una vez por subida.
    // (1) Derechos: la imagen aún no existe, así que no tiene override propio
    //     todavía — hereda por completo los defaults del sitio.
    // (2) Marca de agua: solo para colecciones `public` — D9.
    const rights = resolveRights(await this.site.getRightsDefaults(), null);
    const originalFormat: EmbeddableFormat =
      processed.original.extension === 'png' ? 'png' : 'jpeg';
    const watermarkConfig =
      visibility === 'public' ? await this.site.getWatermarkConfig() : null;

    const storedKeys: string[] = [];
    try {
      // El original nunca lleva marca (D9); sí lleva los derechos incrustados.
      const originalWithRights = await this.metadata.embed(
        processed.original.buffer,
        originalFormat,
        rights,
      );
      const originalStored = await this.storage.put(originalWithRights, {
        extension: processed.original.extension,
        contentType: processed.original.contentType,
        visibility,
      });
      storedKeys.push(originalStored.key);

      const variantRows: {
        storage_key: string;
        label: string;
        format: string;
        width: number;
        height: number;
        bytes: number;
      }[] = [];
      for (const variant of processed.variants) {
        const marked = watermarkConfig
          ? await this.watermark.composite(variant.buffer, watermarkConfig)
          : variant.buffer;
        const withRights = await this.metadata.embed(marked, 'webp', rights);
        const stored = await this.storage.put(withRights, {
          extension: 'webp',
          contentType: 'image/webp',
          visibility,
        });
        storedKeys.push(stored.key);
        variantRows.push({
          storage_key: stored.key,
          label: variant.label,
          format: variant.format,
          width: variant.width,
          height: variant.height,
          bytes: withRights.byteLength,
        });
      }

      const nextSort = await this.prisma.media.count({
        where: { album_id: album.album_id },
      });

      const media = await this.prisma.$transaction(async (tx) => {
        const created = await tx.media.create({
          data: {
            album_id: album.album_id,
            owner_user_id: album.owner_user_id,
            storage_key: originalStored.key,
            original_name: this.sanitizeName(file.originalname),
            mime_type: processed.original.contentType,
            width: processed.original.width,
            height: processed.original.height,
            bytes: processed.original.bytes,
            checksum_sha256: processed.original.checksumSha256,
            placeholder: processed.placeholder || null,
            sort_order: nextSort,
            variants: { create: variantRows },
          },
          include: { variants: true },
        });
        await tx.albums.update({
          where: { album_id: album.album_id },
          data: {
            media_count: { increment: 1 },
            ...(album.cover_media_id
              ? {}
              : { cover_media_id: created.media_id }),
          },
        });
        return created;
      });

      return this.toDto(media, media.variants, visibility);
    } catch (error) {
      // Compensación: si la transacción falló, no dejamos objetos huérfanos.
      await Promise.all(storedKeys.map((key) => this.storage.remove(key)));
      throw error;
    }
  }

  /**
   * Lista las imágenes de un álbum para el Studio (vista del dueño / admin),
   * con las URLs de entrega ya resueltas.
   *
   * @param albumId - Álbum.
   * @param actor - Usuario autenticado (dueño o admin).
   */
  async listForAlbum(albumId: string, actor: AuthenticatedUser) {
    const album = await this.albums.getOwned(albumId, actor);
    const rows = await this.prisma.media.findMany({
      where: { album_id: album.album_id },
      orderBy: { sort_order: 'asc' },
      include: { variants: true },
    });
    const visibility = album.visibility as MediaVisibility;
    return rows.map((m) => this.toDto(m, m.variants, visibility));
  }

  /**
   * Edita alt / caption / orden / estado de curación / derechos de una imagen.
   *
   * El registro de derechos (`dto.rights`) solo se **guarda** — para que el
   * cambio se refleje en los archivos ya servidos hace falta
   * `POST /site/watermark/regenerate` (Fase 11); una subida nueva siempre usa
   * lo vigente en el momento de subirla.
   */
  async update(mediaId: string, actor: AuthenticatedUser, dto: UpdateMediaDto) {
    const { media, visibility } = await this.loadManageable(mediaId, actor);
    const updated = await this.prisma.media.update({
      where: { media_id: media.media_id },
      data: {
        ...(dto.altText !== undefined ? { alt_text: dto.altText } : {}),
        ...(dto.caption !== undefined ? { caption: dto.caption } : {}),
        ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.rights !== undefined
          ? {
              rights:
                dto.rights === null
                  ? Prisma.JsonNull
                  : (sanitizeRightsPartial(dto.rights) as Prisma.InputJsonValue),
            }
          : {}),
      },
      include: { variants: true },
    });
    return this.toDto(updated, updated.variants, visibility);
  }

  /**
   * Cambia el estado de curación de varias imágenes de un álbum a la vez
   * (publicar / pasar a borrador / archivar en bloque — el flujo real cuando
   * se sube en ancho y luego se cura).
   *
   * @param albumId - Álbum de las imágenes.
   * @param actor - Usuario autenticado (dueño del álbum o admin).
   * @param dto - `mediaIds` + `status` destino.
   * @returns `{ ok, updated }` con cuántas filas cambiaron.
   * @throws BadRequestException si algún id no pertenece a ese álbum.
   */
  async setStatusBulk(
    albumId: string,
    actor: AuthenticatedUser,
    dto: BulkStatusDto,
  ): Promise<{ ok: true; updated: number }> {
    const album = await this.albums.getOwned(albumId, actor);
    const owned = await this.prisma.media.findMany({
      where: { album_id: album.album_id, media_id: { in: dto.mediaIds } },
      select: { media_id: true },
    });
    if (owned.length !== new Set(dto.mediaIds).size) {
      throw new BadRequestException(
        'Todas las imágenes deben pertenecer a este álbum.',
      );
    }
    const result = await this.prisma.media.updateMany({
      where: { album_id: album.album_id, media_id: { in: dto.mediaIds } },
      data: { status: dto.status },
    });
    return { ok: true, updated: result.count };
  }

  /** Aplica un orden nuevo a todas las imágenes de un álbum. */
  async reorder(
    albumId: string,
    actor: AuthenticatedUser,
    dto: ReorderMediaDto,
  ): Promise<{ ok: true }> {
    const album = await this.albums.getOwned(albumId, actor);
    const existing = await this.prisma.media.findMany({
      where: { album_id: album.album_id },
      select: { media_id: true },
    });
    const existingIds = new Set(existing.map((i) => i.media_id));
    if (
      dto.orderedIds.length !== existingIds.size ||
      dto.orderedIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'La lista debe contener exactamente las imágenes de este álbum.',
      );
    }
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.media.update({
          where: { media_id: id },
          data: { sort_order: index },
        }),
      ),
    );
    return { ok: true };
  }

  /** Borra una imagen: objetos del almacenamiento + fila + ajustes del álbum. */
  async remove(mediaId: string, actor: AuthenticatedUser): Promise<void> {
    const { media } = await this.loadManageable(mediaId, actor);
    const variants = await this.prisma.media_variants.findMany({
      where: { media_id: media.media_id },
    });

    await this.storage.remove(media.storage_key);
    await Promise.all(
      variants.map((variant) => this.storage.remove(variant.storage_key)),
    );

    await this.prisma.$transaction(async (tx) => {
      // Si esta imagen era la portada, primero se quita la referencia
      // (cover_media_id no tiene FK, pero dejarla apuntando a una imagen
      // borrada confundiría al frontend).
      await tx.albums.updateMany({
        where: { album_id: media.album_id, cover_media_id: media.media_id },
        data: { cover_media_id: null },
      });
      await tx.media.delete({ where: { media_id: media.media_id } });
      await tx.albums.update({
        where: { album_id: media.album_id },
        data: { media_count: { decrement: 1 } },
      });
    });
  }

  /** Carga una imagen y verifica que el actor puede gestionar su álbum. */
  private async loadManageable(mediaId: string, actor: AuthenticatedUser) {
    const media = await this.prisma.media.findUnique({
      where: { media_id: mediaId },
      include: { album: true },
    });
    if (!media) {
      throw new NotFoundException('Imagen no encontrada.');
    }
    if (!this.albums.canManage(media.album, actor)) {
      throw new ForbiddenException('No puedes gestionar esta imagen.');
    }
    return { media, visibility: media.album.visibility as MediaVisibility };
  }

  /** Deja el nombre original del cliente en algo seguro de mostrar/guardar. */
  private sanitizeName(name: string): string {
    return basename(name)
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 255);
  }

  /** Forma de salida de un elemento de media, con las URLs de entrega ya resueltas. */
  private toDto(
    media: {
      media_id: string;
      album_id: string;
      storage_key: string;
      original_name: string | null;
      mime_type: string;
      width: number;
      height: number;
      bytes: number;
      placeholder: string | null;
      alt_text: string | null;
      caption: string | null;
      sort_order: number;
      status: string;
      rights: Prisma.JsonValue;
      created_at: Date;
    },
    variants: { label: string; format: string; storage_key: string; width: number; height: number }[],
    visibility: MediaVisibility,
  ) {
    return {
      mediaId: media.media_id,
      albumId: media.album_id,
      originalName: media.original_name,
      mimeType: media.mime_type,
      width: media.width,
      height: media.height,
      bytes: media.bytes,
      placeholder: media.placeholder,
      altText: media.alt_text,
      caption: media.caption,
      sortOrder: media.sort_order,
      status: media.status,
      rights: sanitizeRightsPartial(media.rights),
      createdAt: media.created_at,
      urls: {
        original: this.storage.urlFor(media.storage_key, visibility),
        ...Object.fromEntries(
          variants.map((v) => [
            v.label,
            this.storage.urlFor(v.storage_key, visibility),
          ]),
        ),
      },
    };
  }
}
