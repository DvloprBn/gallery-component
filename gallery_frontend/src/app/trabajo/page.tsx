import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicGalleries, fetchShowcase, fetchSite } from '@/lib/api';
import { ShowcaseBook } from '@/components/ShowcaseBook';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Trabajo',
  description: 'Todas las colecciones publicadas.',
};

/**
 * Índice de trabajo: todas las colecciones públicas, en el orden que fija el
 * gestor (`sort_order`). Cada tarjeta lleva a `/g/<slug>`.
 */
export default async function TrabajoPage() {
  const [site, collections, showcase] = await Promise.all([
    fetchSite(),
    fetchPublicGalleries(false),
    fetchShowcase(),
  ]);

  return (
    <main className="pf pf-page">
      <header className="pf-page__head">
        <h1 className="pf-page__title">Trabajo</h1>
        {site?.tagline ? (
          <p className="pf-page__lead">{site.tagline}</p>
        ) : null}
      </header>

      {showcase.length > 0 ? (
        <ShowcaseBook media={showcase} title={site?.siteTitle ?? 'Trabajo'} />
      ) : null}

      {collections.length === 0 ? (
        <p className="muted">Todavía no hay colecciones publicadas.</p>
      ) : (
        <ul className="pf-grid pf-grid--wide">
          {collections.map((c) => (
            <li key={c.slug} className="pf-card">
              <Link href={`/g/${c.slug}`}>
                <span className="pf-card__media">
                  {c.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="pf-card__media--empty" />
                  )}
                </span>
                <span className="pf-card__body">
                  <span className="pf-card__title">{c.title}</span>
                  {c.description ? (
                    <span className="pf-card__desc">{c.description}</span>
                  ) : null}
                  <span className="pf-card__meta">
                    {c.mediaCount}{' '}
                    {c.mediaCount === 1 ? 'fotografía' : 'fotografías'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
