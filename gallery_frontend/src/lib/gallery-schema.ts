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

/** Una imagen de la galería, tal como la devuelve `GET /g/:slug`. */
export const galleryImageSchema = z.object({
  imageId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placeholder: z.string().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
  urls: z.record(z.string(), z.string().url()),
});

/** La respuesta completa de `GET /g/:slug`. */
export const gallerySchema = z.object({
  album: z.object({
    title: z.string(),
    description: z.string().nullable(),
    slug: z.string(),
    layout: z.enum(['masonry', 'justified', 'grid', 'carousel']).catch('masonry'),
    theme: themeSchema,
    visibility: z.enum(['public', 'unlisted', 'private']),
    imageCount: z.number().int().nonnegative(),
  }),
  images: z.array(galleryImageSchema),
});

export type GalleryImage = z.infer<typeof galleryImageSchema>;
export type Gallery = z.infer<typeof gallerySchema>;
