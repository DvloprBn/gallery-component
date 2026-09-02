import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GalleryView } from '@/components/GalleryView';
import { fetchGallery } from '@/lib/api';

/** Datos en vivo (incluye token de compartir) — no se prerenderiza. */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * Metadatos de la página de galería. Un álbum que no sea `public` se marca
 * `noindex` para que no acabe en buscadores aunque alguien comparta el enlace.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { token } = await searchParams;
  const gallery = await fetchGallery(slug, token).catch(() => null);
  if (!gallery) {
    return { title: 'Galería no encontrada' };
  }
  return {
    title: gallery.album.title,
    description: gallery.album.description ?? undefined,
    robots:
      gallery.album.visibility === 'public'
        ? undefined
        : { index: false, follow: false },
  };
}

/**
 * Página pública de una galería (`/g/<slug>`). Server Component: pide y valida
 * los datos en el servidor y entrega la vista interactiva al cliente.
 */
export default async function GalleryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { token } = await searchParams;
  const gallery = await fetchGallery(slug, token);
  if (!gallery) {
    notFound();
  }
  return <GalleryView gallery={gallery} />;
}
