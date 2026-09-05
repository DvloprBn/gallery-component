import { gallerySchema, type Gallery } from './gallery-schema';

/**
 * URL base de la API para peticiones desde el SERVIDOR (Server Components).
 * En el contenedor es la dirección interna de Docker; fuera, el localhost del
 * backend.
 */
function serverApiBase(): string {
  return (
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:3050'
  ).replace(/\/$/, '');
}

/**
 * Pide la galería de un álbum por su slug.
 *
 * @param slug - Slug del álbum.
 * @param token - Token de compartir (para álbumes privados/unlisted), opcional.
 * @returns La galería validada, o `null` si no existe / no hay acceso (404).
 * @throws Error si la API responde con un error distinto de 404.
 */
export async function fetchGallery(
  slug: string,
  token?: string,
): Promise<Gallery | null> {
  const url = new URL(`${serverApiBase()}/g/${encodeURIComponent(slug)}`);
  if (token) {
    url.searchParams.set('token', token);
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`La API respondió ${response.status} al pedir la galería.`);
  }

  return gallerySchema.parse(await response.json());
}

/** Una tarjeta del índice de colecciones públicas. */
export interface PublicGalleryCard {
  slug: string;
  title: string;
  description: string | null;
  mediaCount: number;
  coverUrl: string | null;
}

/**
 * Pide el índice de colecciones públicas.
 *
 * @param featuredOnly - `true` → solo las marcadas para la portada.
 * @returns La lista (vacía si no hay ninguna o si la API falla — el índice no
 *          debe tumbar la portada).
 */
export async function fetchPublicGalleries(
  featuredOnly = false,
): Promise<PublicGalleryCard[]> {
  try {
    const url = new URL(`${serverApiBase()}/galleries`);
    if (featuredOnly) {
      url.searchParams.set('featured', 'true');
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    return Array.isArray(data) ? (data as PublicGalleryCard[]) : [];
  } catch {
    return [];
  }
}

/** La imagen del hero de la portada, con sus URLs de entrega ya resueltas. */
export interface SiteHero {
  mediaId: string;
  width: number;
  height: number;
  placeholder: string | null;
  urls: Record<string, string>;
}

/** Configuración de marca de agua (Fase 11). */
export interface SiteWatermark {
  hasAsset: boolean;
  previewUrl: string | null;
  text: string;
  opacity: number;
  placement: 'tiled' | 'corner';
}

/** Registro de derechos por defecto del sitio (Fase 11, D10). */
export interface SiteRights {
  rightsHolder: string;
  creator: string;
  creditLine: string;
  rightsStatement: string;
  licenseTerms: string;
  licensorUrl: string;
  /** El aviso ya resuelto (con su fallback) — listo para el pie/lightbox. */
  noticeText: string;
}

/** Identidad pública del sitio (portafolio): la devuelve `GET /site`. */
export interface Site {
  siteTitle: string;
  ownerName: string;
  tagline: string;
  bio: string;
  aboutBody: string;
  contactEmail: string;
  contactIntro: string;
  instagram: string;
  hero: SiteHero | null;
  watermark: SiteWatermark;
  rights: SiteRights;
}

/**
 * Pide la identidad del sitio (nombre, declaración, "sobre mí", contacto, hero).
 *
 * @returns Los ajustes del sitio, o `null` si la API falla — el chrome del
 *          sitio degrada a valores neutros, nunca peta la página.
 */
export async function fetchSite(): Promise<Site | null> {
  try {
    const response = await fetch(`${serverApiBase()}/site`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as Site;
  } catch {
    return null;
  }
}
