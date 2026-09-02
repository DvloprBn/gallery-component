/** Álbum tal como lo devuelven los endpoints autenticados (`GET /albums`, `/albums/:id`). */
export interface AlbumRow {
  album_id: string;
  owner_user_id: string;
  title: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  layout: 'masonry' | 'justified' | 'grid' | 'carousel';
  theme: Record<string, unknown>;
  cover_image_id: string | null;
  sort_order: number;
  /** Se muestra en la portada del sitio (solo aplica a colecciones públicas). */
  featured: boolean;
  image_count: number;
  created_at: string;
  updated_at: string;
}

/** Imagen tal como la devuelven `POST /albums/:id/images` y `GET /albums/:id/images`. */
export interface ImageDto {
  imageId: string;
  albumId: string;
  originalName: string | null;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  placeholder: string | null;
  altText: string | null;
  caption: string | null;
  sortOrder: number;
  createdAt: string;
  urls: Record<string, string>;
}

/** Enlace de compartir (sin el token en claro). */
export interface ShareTokenRow {
  shareTokenId: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export const LAYOUTS = ['masonry', 'justified', 'grid', 'carousel'] as const;
export const MOTION_PRESETS = ['fade-up', 'fade', 'zoom', 'none'] as const;
export const FONT_FAMILIES = ['system', 'serif', 'mono'] as const;
