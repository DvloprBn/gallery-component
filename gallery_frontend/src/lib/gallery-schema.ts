import { z } from 'zod';

/**
 * Esquema del `theme` de un álbum: un objeto cerrado de *tokens de diseño*,
 * nunca CSS libre. Todo es opcional y se valida a un rango razonable — un
 * valor fuera de esquema se descarta y se usa el default del tema.
 */
export const themeSchema = z
  .object({
    colors: z
      .object({
        bg: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
        fg: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
        accent: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
      })
      .partial()
      .optional(),
    typography: z
      .object({
        fontFamily: z.enum(['system', 'serif', 'mono']).optional(),
        scale: z.number().min(0.8).max(1.4).optional(),
      })
      .partial()
      .optional(),
    layout: z
      .object({
        gap: z.number().int().min(0).max(48).optional(),
        radius: z.number().int().min(0).max(32).optional(),
        maxColumns: z.number().int().min(1).max(6).optional(),
      })
      .partial()
      .optional(),
    motion: z
      .object({
        preset: z.enum(['fade-up', 'fade', 'zoom', 'none']).optional(),
        stagger: z.number().int().min(0).max(200).optional(),
        durationMs: z.number().int().min(0).max(2000).optional(),
      })
      .partial()
      .optional(),
  })
  .partial()
  .catch({});

export type GalleryTheme = z.infer<typeof themeSchema>;

/** Un elemento de la galería (foto o video), tal como lo devuelve `GET /g/:slug`. */
export const galleryMediaSchema = z.object({
  mediaId: z.string(),
  kind: z.enum(['photo', 'video']).catch('photo'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Solo video: duración en milisegundos (para el badge de la miniatura). */
  durationMs: z.number().int().nonnegative().nullable().catch(null),
  placeholder: z.string().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
  /**
   * Foto: `thumb`/`small`/`medium`/`large`. Video: esos (el póster) más
   * `preview` (MP4 progresivo 720p) — el HLS llega en la Fase 14c.
   */
  urls: z.record(z.string(), z.string().url()),
});

/** La respuesta completa de `GET /g/:slug`. */
export const gallerySchema = z.object({
  album: z.object({
    title: z.string(),
    description: z.string().nullable(),
    slug: z.string(),
    layout: z.enum(['masonry', 'justified', 'grid', 'carousel', 'book']).catch('masonry'),
    theme: themeSchema,
    visibility: z.enum(['public', 'unlisted', 'private']),
    mediaCount: z.number().int().nonnegative(),
  }),
  media: z.array(galleryMediaSchema),
});

export type GalleryMedia = z.infer<typeof galleryMediaSchema>;
export type Gallery = z.infer<typeof gallerySchema>;
