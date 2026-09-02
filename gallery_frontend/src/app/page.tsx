import { fetchPublicGalleries } from '@/lib/api';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

/**
 * Landing / índice. Demo de vitrina: lista las galerías públicas y resume qué
 * muestra el proyecto.
 */
export default async function HomePage() {
  const galleries = await fetchPublicGalleries();

  return (
    <main className="shell">
      <h1>Galería</h1>
      <p>
        Demo de galería de imágenes con personalización y animaciones de grado
        profesional. Backend con subida segura (validación por contenido,
        re-codificado sin EXIF), derivados responsivos, visibilidad por álbum y
        entrega firmada; frontend con layouts, lightbox y animaciones que
        respetan <code>prefers-reduced-motion</code>.
      </p>

      {galleries.length === 0 ? (
        <p className="muted">
          No hay galerías públicas todavía. Siembra la demo:{' '}
          <code>
            docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts
          </code>
        </p>
      ) : (
        <ul className="index-list">
          {galleries.map((gallery) => (
            <li key={gallery.slug} className="index-card">
              <a href={`/g/${gallery.slug}`}>
                {gallery.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={gallery.coverUrl}
                    alt=""
                    className="index-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="index-cover index-cover--empty" />
                )}
                <span className="index-title">{gallery.title}</span>
                <span className="index-meta">
                  {gallery.imageCount}{' '}
                  {gallery.imageCount === 1 ? 'imagen' : 'imágenes'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
