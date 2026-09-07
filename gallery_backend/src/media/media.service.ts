import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type {
  MediaVisibility,
  ObjectStream,
} from '../storage/storage-driver.interface';
import { sha256Hex } from '../common/utils/token.util';
import { verifyMediaSignature } from '../storage/media-signing';

/** TTL (s) de las URLs firmadas de los objetos HLS de un álbum privado (Fase 14c). */
const HLS_URL_TTL = Math.max(
  600,
  Number(process.env.MEDIA_HLS_URL_TTL_SECONDS) || 3600,
);

/** Un elemento (foto o video) tal como lo consume la galería pública. */
export interface PublicMedia {
  mediaId: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  /** Solo video: duración en milisegundos (para el badge de la miniatura). */
  durationMs: number | null;
  placeholder: string | null;
  altText: string | null;
  caption: string | null;
  /**
   * Foto: `thumb`/`small`/`medium`/`large` (WebP). Video: esos mismos (el
   * póster) más `preview` (MP4 progresivo 720p) — el HLS llega en la Fase 14c.
   */
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

/** Una fila de `media` con sus derivados — lo que consume `toPublicMedia`. */
type MediaWithVariants = Prisma.mediaGetPayload<{ include: { variants: true } }>;

/** Cuántos elementos devuelve `GET /showcase` (el fotolibro de `/trabajo`). */
export const SHOWCASE_LIMIT = 20;

/** Tope de videos dentro del `showcase` — el resto son fotos. */
const SHOWCASE_MAX_VIDEOS = 4;

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
          // Preferimos el derivado `small`; si no hay (p. ej. un video cuya
          // portada aún no está lista) caemos al original — que puede ser null.
          const key = small?.storage_key ?? cover.storage_key;
          coverUrl = key ? this.storage.urlFor(key, 'public') : null;
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
      media: rows.map((m) => this.toPublicMedia(m, visibility)),
    };
  }

  /**
   * Fotolibro de `/trabajo` (Fase 15e): los elementos publicados más recientes
   * de **todas** las colecciones `public`, mezclando foto y video. El original
   * de alta resolución nunca se incluye (D9) — igual que en `getGallery` para
   * un álbum `public`.
   *
   * La mezcla es deliberada: se toman hasta {@link SHOWCASE_MAX_VIDEOS} videos
   * (los más nuevos) y el resto fotos, y luego se **intercalan** para que el
   * libro alterne en vez de amontonar los videos al inicio.
   *
   * @param limit - Cuántos elementos devolver (1–48; por defecto {@link SHOWCASE_LIMIT}).
   * @returns Los elementos ya en orden de hojeo, con sus URLs de entrega.
   */
  async listShowcase(limit: number = SHOWCASE_LIMIT): Promise<PublicMedia[]> {
    const take = Math.min(Math.max(Math.trunc(limit) || SHOWCASE_LIMIT, 1), 48);

    // Se pide de más (`take * 3`, con tope) para tener de dónde escoger la
    // cuota de videos aunque queden lejos en la lista por fecha.
    const rows = await this.prisma.media.findMany({
      where: {
        status: 'published',
        album: { visibility: 'public' },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(take * 3, 120),
      include: { variants: true },
    });

    // Un video marcado `published` pero cuyo transcode nunca terminó no tiene
    // derivados ni HLS — no hay nada que enseñar, así que fuera del fotolibro
    // (una foto siempre tiene sus 4 derivados; esto solo descarta media rota).
    const showable = rows.filter(
      (m) => m.variants.length > 0 || m.hls_manifest_key,
    );
    const videos = showable.filter((m) => m.kind === 'video');
    const photos = showable.filter((m) => m.kind === 'photo');

    const pickedVideos = videos.slice(0, Math.min(SHOWCASE_MAX_VIDEOS, take));
    const pickedPhotos = photos.slice(0, take - pickedVideos.length);

    return this.interleave(pickedPhotos, pickedVideos).map((m) =>
      this.toPublicMedia(m, 'public'),
    );
  }

  /**
   * Reparte `videos` de forma pareja dentro de `photos` conservando el orden
   * relativo de cada grupo. Con 3 videos y 17 fotos, los videos caen ~cada 5
   * hojas en vez de todos al principio.
   *
   * @param photos - Las fotos, ya ordenadas.
   * @param videos - Los videos, ya ordenados.
   * @returns Un único arreglo intercalado (longitud = `photos.length + videos.length`).
   */
  private interleave<T>(photos: T[], videos: T[]): T[] {
    if (videos.length === 0) return photos;
    if (photos.length === 0) return videos;

    const total = photos.length + videos.length;
    const step = total / (videos.length + 1); // hueco entre videos
    const out: T[] = [];
    let vi = 0;
    let pi = 0;
    for (let i = 0; i < total; i++) {
      const isVideoSlot =
        vi < videos.length && i >= Math.round((vi + 1) * step) - 1;
      if (isVideoSlot) {
        out.push(videos[vi++]);
      } else if (pi < photos.length) {
        out.push(photos[pi++]);
      } else {
        out.push(videos[vi++]);
      }
    }
    return out;
  }

  /**
   * Proyecta una fila de `media` (con sus derivados) a la forma pública.
   *
   * @param m - La fila con `variants` incluidos.
   * @param visibility - Visibilidad del álbum dueño: decide si se expone el
   *        original limpio (`original`, solo `private` — D9) y el TTL de las
   *        URLs firmadas del HLS.
   * @returns El elemento listo para la galería / el fotolibro.
   */
  private toPublicMedia(
    m: MediaWithVariants,
    visibility: MediaVisibility,
  ): PublicMedia {
    return {
      mediaId: m.media_id,
      kind: m.kind,
      width: m.width,
      height: m.height,
      durationMs: m.duration_ms ?? null,
      placeholder: m.placeholder,
      altText: m.alt_text,
      caption: m.caption,
      urls: {
        // El original/master de alta resolución (limpio, sin marca — D9)
        // NUNCA se ofrece en una galería `public`/`unlisted`: sería regalar
        // exactamente lo que la Fase 12 vende con licencia. Un álbum
        // `private` sigue incluyéndolo — un enlace de compartir implica que
        // el dueño ya confió el original a ese visitante concreto.
        ...(visibility === 'private' && m.storage_key
          ? { original: this.storage.urlFor(m.storage_key, visibility) }
          : {}),
        // `hls` = el master.m3u8 (Fase 14c) — reproducción adaptativa; el
        // `preview` MP4 sigue como respaldo para navegadores sin `hls.js`.
        ...(m.hls_manifest_key
          ? {
              hls: this.storage.urlFor(
                m.hls_manifest_key,
                visibility,
                HLS_URL_TTL,
              ),
            }
          : {}),
        ...Object.fromEntries(
          m.variants.map((v) => [
            v.label,
            this.storage.urlFor(v.storage_key, visibility),
          ]),
        ),
      },
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
    if (variant) {
      return variant.media.album.visibility as MediaVisibility;
    }
    // Objetos HLS (master.m3u8, stream playlists, segmentos .ts) — viven en
    // `media.hls_keys`, no en `storage_key` ni en `media_variants` (Fase 14c).
    const hlsOwner = await this.prisma.media.findFirst({
      where: { hls_keys: { has: key } },
      include: { album: { select: { visibility: true } } },
    });
    return hlsOwner
      ? (hlsOwner.album.visibility as MediaVisibility)
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
