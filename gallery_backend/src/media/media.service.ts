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
export interface PublicMedia {
  mediaId: string;
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
    mediaCount: number;
  };
  media: PublicMedia[];
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
   * Lista las colecciones `public` que tienen al menos una imagen **publicada**,
   * ordenadas por `sort_order` y luego por fecha — para el índice del sitio y la
   * portada. Solo cuenta y muestra imágenes `status = 'published'` (la curación
   * de la Fase 10b: se sube en ancho y el público ve solo la selección).
   *
   * @param opts.limit - Máximo de colecciones (1–48).
   * @param opts.featuredOnly - Solo las marcadas para la portada.
   * @returns Cada colección con su slug, título, conteo de publicadas y la URL
   *          de la miniatura de portada (si tiene una publicada).
   */
  async listPublic(opts: { limit?: number; featuredOnly?: boolean } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 24, 1), 48);
    const albums = await this.prisma.albums.findMany({
      where: {
        visibility: 'public',
        media: { some: { status: 'published' } },
        ...(opts.featuredOnly ? { featured: true } : {}),
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      take,
    });

    return Promise.all(
      albums.map(async (album) => {
        const publishedCount = await this.prisma.media.count({
          where: { album_id: album.album_id, status: 'published' },
        });

        // Portada: la imagen elegida si está publicada; si no (o no hay
        // elegida), la primera publicada por orden.
        let cover = album.cover_media_id
          ? await this.prisma.media.findFirst({
              where: {
                media_id: album.cover_media_id,
                status: 'published',
              },
              include: { variants: true },
            })
          : null;
        if (!cover) {
          cover = await this.prisma.media.findFirst({
            where: { album_id: album.album_id, status: 'published' },
            orderBy: { sort_order: 'asc' },
            include: { variants: true },
          });
        }

        let coverUrl: string | null = null;
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
          mediaCount: publishedCount,
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

    // La galería pública muestra solo la selección publicada — nunca borradores
    // ni archivadas, tenga o no un enlace de compartir.
    const rows = await this.prisma.media.findMany({
      where: { album_id: album.album_id, status: 'published' },
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
        mediaCount: rows.length,
      },
      media: rows.map((m) => ({
        mediaId: m.media_id,
        width: m.width,
        height: m.height,
        placeholder: m.placeholder,
        altText: m.alt_text,
        caption: m.caption,
        urls: {
          // El original de alta resolución (limpio, sin marca de agua — D9)
          // NUNCA se ofrece en una galería `public`/`unlisted`: sería
          // regalar exactamente lo que la Fase 12 vende con licencia. Un
          // álbum `private` sigue incluyéndolo — un enlace de compartir
          // implica que el dueño ya confió el original a ese visitante
          // concreto, es un nivel de confianza distinto al de un enlace
          // público/no listado que cualquiera puede encontrar.
          ...(visibility === 'private'
            ? { original: this.storage.urlFor(m.storage_key, visibility) }
            : {}),
          ...Object.fromEntries(
            m.variants.map((v) => [
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
    const media = await this.prisma.media.findUnique({
      where: { storage_key: key },
      include: { album: { select: { visibility: true } } },
    });
    if (media) {
      return media.album.visibility as MediaVisibility;
    }
    const variant = await this.prisma.media_variants.findUnique({
      where: { storage_key: key },
      include: {
        media: { include: { album: { select: { visibility: true } } } },
      },
    });
    return variant
      ? (variant.media.album.visibility as MediaVisibility)
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
