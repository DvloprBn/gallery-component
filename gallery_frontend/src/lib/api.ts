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

/** Una tarjeta del índice de galerías públicas. */
export interface PublicGalleryCard {
  slug: string;
  title: string;
  description: string | null;
  imageCount: number;
  coverUrl: string | null;
}

/**
 * Pide el índice de galerías públicas recientes.
 *
 * @returns La lista (vacía si no hay ninguna o si la API falla — el índice no
 *          debe tumbar la portada).
 */
export async function fetchPublicGalleries(): Promise<PublicGalleryCard[]> {
  try {
    const response = await fetch(`${serverApiBase()}/galleries`, {
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    return Array.isArray(data) ? (data as PublicGalleryCard[]) : [];
  } catch {
    return [];
  }
}
