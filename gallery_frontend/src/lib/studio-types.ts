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
  cover_media_id: string | null;
  sort_order: number;
  /** Se muestra en la portada del sitio (solo aplica a colecciones públicas). */
  featured: boolean;
  media_count: number;
  created_at: string;
  updated_at: string;
}

/** Estados de curación de un elemento (Fase 10b). */
export const MEDIA_STATUSES = ['published', 'draft', 'archived'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** Etiqueta en español de cada estado, para la interfaz. */
export const MEDIA_STATUS_LABEL: Record<MediaStatus, string> = {
  published: 'Publicada',
  draft: 'Borrador',
  archived: 'Archivada',
};

/**
 * Registro de derechos propio de un elemento (Fase 11, D10) — solo los campos
 * que sobreescriben los del sitio; lo que falte hereda de `site.rights`.
 */
export interface MediaRights {
  rightsHolder?: string;
  creator?: string;
  creditLine?: string;
  rightsStatement?: string;
  licenseTerms?: string;
  licensorUrl?: string;
}

/** Elemento tal como lo devuelven `POST /albums/:id/media` y `GET /albums/:id/media`. */
export interface MediaDto {
  mediaId: string;
  albumId: string;
  kind: 'photo' | 'video';
  originalName: string | null;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  placeholder: string | null;
  altText: string | null;
  caption: string | null;
  sortOrder: number;
  /** Curación: solo las `published` se ven en la galería pública. */
  status: MediaStatus;
  /** Override de derechos de este elemento (vacío = hereda todo del sitio). */
  rights: MediaRights;
  createdAt: string;
  /** Solo video: duración en ms (para mostrar la longitud). */
  durationMs: number | null;
  /** Solo video: `true` mientras el transcode en segundo plano no ha terminado. */
  processing: boolean;
  /** Solo video: mensaje si el transcode falló (el elemento queda sin URLs). */
  processingError: string | null;
  urls: Record<string, string>;
}

/** Estado del transcode de un video — lo devuelve `GET /media/:id/processing`. */
export interface ProcessingState {
  state: 'processing' | 'done' | 'error';
  step: string;
  error?: string;
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
