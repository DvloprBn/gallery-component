import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { basename } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AlbumsService } from '../albums/albums.service';
import { ImagePipelineService } from '../media-processing/image-pipeline.service';
import { StorageService } from '../storage/storage.service';
import type { MediaVisibility } from '../storage/storage-driver.interface';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ReorderImagesDto, UpdateImageDto } from './dto/image.dto';

/** Un archivo subido (memory storage de multer). */
export interface UploadedImageFile {
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
  ) {}

  /**
   * Sube una imagen a un álbum.
   *
   * Flujo: rate limit → `pipeline.process` (valida por contenido, re-codifica,
   * quita EXIF, genera derivados + placeholder) → sube original y derivados al
   * almacenamiento → persiste `images` + `image_variants` + `image_count` en
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
    file: UploadedImageFile,
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

    const storedKeys: string[] = [];
    try {
      const originalStored = await this.storage.put(processed.original.buffer, {
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
        const stored = await this.storage.put(variant.buffer, {
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
          bytes: variant.bytes,
        });
      }

      const nextSort = await this.prisma.images.count({
        where: { album_id: album.album_id },
      });

      const image = await this.prisma.$transaction(async (tx) => {
        const created = await tx.images.create({
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
            image_count: { increment: 1 },
            ...(album.cover_image_id
              ? {}
              : { cover_image_id: created.image_id }),
          },
        });
        return created;
      });

      return this.toDto(image, image.variants, visibility);
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
    const images = await this.prisma.images.findMany({
      where: { album_id: album.album_id },
      orderBy: { sort_order: 'asc' },
      include: { variants: true },
    });
    const visibility = album.visibility as MediaVisibility;
    return images.map((image) => this.toDto(image, image.variants, visibility));
  }

  /** Edita alt / caption / orden de una imagen. */
  async update(imageId: string, actor: AuthenticatedUser, dto: UpdateImageDto) {
    const { image, visibility } = await this.loadManageable(imageId, actor);
    const updated = await this.prisma.images.update({
      where: { image_id: image.image_id },
      data: {
        ...(dto.altText !== undefined ? { alt_text: dto.altText } : {}),
        ...(dto.caption !== undefined ? { caption: dto.caption } : {}),
        ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
      },
      include: { variants: true },
    });
    return this.toDto(updated, updated.variants, visibility);
  }

  /** Aplica un orden nuevo a todas las imágenes de un álbum. */
  async reorder(
    albumId: string,
    actor: AuthenticatedUser,
    dto: ReorderImagesDto,
  ): Promise<{ ok: true }> {
    const album = await this.albums.getOwned(albumId, actor);
    const existing = await this.prisma.images.findMany({
      where: { album_id: album.album_id },
      select: { image_id: true },
    });
    const existingIds = new Set(existing.map((i) => i.image_id));
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
        this.prisma.images.update({
          where: { image_id: id },
          data: { sort_order: index },
        }),
      ),
    );
    return { ok: true };
  }

  /** Borra una imagen: objetos del almacenamiento + fila + ajustes del álbum. */
  async remove(imageId: string, actor: AuthenticatedUser): Promise<void> {
    const { image } = await this.loadManageable(imageId, actor);
    const variants = await this.prisma.image_variants.findMany({
      where: { image_id: image.image_id },
    });

    await this.storage.remove(image.storage_key);
    await Promise.all(
      variants.map((variant) => this.storage.remove(variant.storage_key)),
    );

    await this.prisma.$transaction(async (tx) => {
      // Si esta imagen era la portada, primero se quita la referencia
      // (cover_image_id no tiene FK, pero dejarla apuntando a una imagen
      // borrada confundiría al frontend).
      await tx.albums.updateMany({
        where: { album_id: image.album_id, cover_image_id: image.image_id },
        data: { cover_image_id: null },
      });
      await tx.images.delete({ where: { image_id: image.image_id } });
      await tx.albums.update({
        where: { album_id: image.album_id },
        data: { image_count: { decrement: 1 } },
      });
    });
  }

  /** Carga una imagen y verifica que el actor puede gestionar su álbum. */
  private async loadManageable(imageId: string, actor: AuthenticatedUser) {
    const image = await this.prisma.images.findUnique({
      where: { image_id: imageId },
      include: { album: true },
    });
    if (!image) {
      throw new NotFoundException('Imagen no encontrada.');
    }
    if (!this.albums.canManage(image.album, actor)) {
      throw new ForbiddenException('No puedes gestionar esta imagen.');
    }
    return { image, visibility: image.album.visibility as MediaVisibility };
  }

  /** Deja el nombre original del cliente en algo seguro de mostrar/guardar. */
  private sanitizeName(name: string): string {
    return basename(name)
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 255);
  }

  /** Forma de salida de una imagen, con las URLs de entrega ya resueltas. */
  private toDto(
    image: {
      image_id: string;
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
      created_at: Date;
    },
    variants: { label: string; format: string; storage_key: string; width: number; height: number }[],
    visibility: MediaVisibility,
  ) {
    return {
      imageId: image.image_id,
      albumId: image.album_id,
      originalName: image.original_name,
      mimeType: image.mime_type,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      placeholder: image.placeholder,
      altText: image.alt_text,
      caption: image.caption,
      sortOrder: image.sort_order,
      createdAt: image.created_at,
      urls: {
        original: this.storage.urlFor(image.storage_key, visibility),
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
