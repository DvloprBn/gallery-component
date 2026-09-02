import { fetchPublicGalleries } from '@/lib/api';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

/**
 * Landing / índice. Demo de vitrina: un encabezado breve y la cuadrícula de
 * galerías públicas.
 */
export default async function HomePage() {
  const galleries = await fetchPublicGalleries();

  return (
    <main className="landing">
      <section className="landing-hero">
        <h1>Galería</h1>
        <p>
          Galería de imágenes con personalización y animaciones de grado
          profesional. Subida segura, derivados responsivos, visibilidad por
          álbum y entrega firmada — con un frontend que respeta{' '}
          <code>prefers-reduced-motion</code>.
        </p>
      </section>

      {galleries.length === 0 ? (
        <p className="muted landing-empty">
          No hay galerías públicas todavía. Siembra la demo:{' '}
          <code>
            docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts
          </code>
        </p>
      ) : (
        <section>
          <h2 className="landing-subhead">Galerías</h2>
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
        </section>
      )}
    </main>
  );
}
