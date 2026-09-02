import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type {
  MediaVisibility,
  ObjectStream,
} from '../storage/storage-driver.interface';
import { sha256Hex } from '../common/utils/token.util';
import { verifyMediaSignature } from '../storage/media-signing';

/** Una imagen tal como la consume la galería pública. */
export interface PublicImage {
  imageId: string;
  width: number;
  height: number;
  placeholder: string | null;
  altText: string | null;
  caption: string | null;
  urls: Record<string, string>;
}

/** La galería pública de un álbum. */
export interface PublicGallery {
  album: {
    title: string;
    description: string | null;
    slug: string;
    layout: string;
    theme: unknown;
    visibility: MediaVisibility;
    imageCount: number;
  };
  images: PublicImage[];
}

/**
 * Ensamblado de la galería pública y servido de archivos por el driver de
 * disco. Todo aquí es de solo lectura.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Lista los álbumes `public` más recientes, para el índice del sitio.
   *
   * @param limit - Máximo de álbumes (1–48).
   * @returns Cada álbum con su slug, título, conteo y la URL de la miniatura
   *          de portada (si tiene).
   */
  async listPublic(limit = 24) {
    const take = Math.min(Math.max(limit, 1), 48);
    const albums = await this.prisma.albums.findMany({
      where: { visibility: 'public', image_count: { gt: 0 } },
      orderBy: { created_at: 'desc' },
      take,
    });

    return Promise.all(
      albums.map(async (album) => {
        let coverUrl: string | null = null;
        const cover = album.cover_image_id
          ? await this.prisma.images.findUnique({
              where: { image_id: album.cover_image_id },
              include: { variants: true },
            })
          : null;
        if (cover) {
          const small = cover.variants.find((v) => v.label === 'small');
          coverUrl = this.storage.urlFor(
            (small ?? cover).storage_key,
            'public',
          );
        }
        return {
          slug: album.slug,
          title: album.title,
          description: album.description,
          imageCount: album.image_count,
          coverUrl,
        };
      }),
    );
  }

  /**
   * Devuelve la galería de un álbum por su slug, aplicando el control de
   * acceso por visibilidad.
   *
   * @param slug - Slug del álbum.
   * @param shareToken - Token de compartir de la query (opcional).
   * @returns El álbum + sus imágenes ordenadas, con URLs de entrega.
   * @throws NotFoundException si el álbum no existe o el solicitante no tiene
   *         acceso (para un álbum privado sin token, es indistinguible de que
   *         no exista).
   */
  async getGallery(slug: string, shareToken?: string): Promise<PublicGallery> {
    const album = await this.prisma.albums.findUnique({ where: { slug } });
    if (!album) {
      throw new NotFoundException('Galería no encontrada.');
    }
    const visibility = album.visibility as MediaVisibility;

    if (visibility === 'private') {
      const ok = shareToken
        ? await this.isShareTokenValid(album.album_id, shareToken)
        : false;
      if (!ok) {
        throw new NotFoundException('Galería no encontrada.');
      }
    }

    const images = await this.prisma.images.findMany({
      where: { album_id: album.album_id },
      orderBy: { sort_order: 'asc' },
      include: { variants: true },
    });

    return {
      album: {
        title: album.title,
        description: album.description,
        slug: album.slug,
        layout: album.layout,
        theme: album.theme,
        visibility,
        imageCount: album.image_count,
      },
      images: images.map((image) => ({
        imageId: image.image_id,
        width: image.width,
        height: image.height,
        placeholder: image.placeholder,
        altText: image.alt_text,
        caption: image.caption,
        urls: {
          original: this.storage.urlFor(image.storage_key, visibility),
          ...Object.fromEntries(
            image.variants.map((v) => [
              v.label,
              this.storage.urlFor(v.storage_key, visibility),
            ]),
          ),
        },
      })),
    };
  }

  /**
   * Resuelve un objeto para `GET /media/:key` (solo driver de disco).
   *
   * @param key - La clave del objeto (viene en la URL).
   * @param exp - `exp` de la query (para objetos privados).
   * @param sig - `sig` de la query (para objetos privados).
   * @returns El stream + metadatos + directivas de caché.
   * @throws NotFoundException si la clave no corresponde a ningún objeto, o si
   *         el objeto es privado y la firma falta / no valida / expiró.
   */
  async serveObject(
    key: string,
    exp: string | undefined,
    sig: string | undefined,
  ): Promise<ObjectStream & { cacheControl: string }> {
    const visibility = await this.visibilityOfKey(key);
    if (!visibility) {
      throw new NotFoundException();
    }
    if (visibility === 'private' && !verifyMediaSignature(key, exp, sig)) {
      throw new NotFoundException();
    }

    const object = await this.storage.read(key);
    if (!object) {
      throw new NotFoundException();
    }
    return {
      ...object,
      cacheControl:
        visibility === 'private'
          ? 'private, no-store'
          : 'public, max-age=3600, immutable',
    };
  }

  /** ¿A qué visibilidad de álbum pertenece esta clave de almacenamiento? */
  private async visibilityOfKey(key: string): Promise<MediaVisibility | null> {
    const image = await this.prisma.images.findUnique({
      where: { storage_key: key },
      include: { album: { select: { visibility: true } } },
    });
    if (image) {
      return image.album.visibility as MediaVisibility;
    }
    const variant = await this.prisma.image_variants.findUnique({
      where: { storage_key: key },
      include: {
        image: { include: { album: { select: { visibility: true } } } },
      },
    });
    return variant
      ? (variant.image.album.visibility as MediaVisibility)
      : null;
  }

  /** ¿Es válido (no revocado, no caducado) este token de compartir para el álbum? */
  private async isShareTokenValid(
    albumId: string,
    rawToken: string,
  ): Promise<boolean> {
    const record = await this.prisma.album_share_tokens.findUnique({
      where: { token_hash: sha256Hex(rawToken) },
    });
    return Boolean(
      record &&
        record.album_id === albumId &&
        !record.revoked &&
        (!record.expires_at || record.expires_at.getTime() > Date.now()),
    );
  }
}
