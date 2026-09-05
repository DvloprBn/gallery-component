import Link from 'next/link';
import { BlurhashCanvas } from '@/components/BlurhashCanvas';
import { fetchPublicGalleries, fetchSite } from '@/lib/api';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

/**
 * Portada del portafolio: hero a sangre completa con el nombre y la
 * declaración del autor, una nota breve y la cuadrícula de colecciones
 * destacadas. Todo el contenido viene de `GET /site` y `GET /galleries`.
 */
export default async function HomePage() {
  const [site, featured] = await Promise.all([
    fetchSite(),
    fetchPublicGalleries(true),
  ]);

  const heroUrl = site?.hero
    ? site.hero.urls.large ?? site.hero.urls.medium ?? site.hero.urls.original
    : null;

  return (
    <main className="pf">
      <section className={`pf-hero${heroUrl ? '' : ' pf-hero--plain'}`}>
        {site?.hero ? (
          <BlurhashCanvas hash={site.hero.placeholder} />
        ) : null}
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt=""
            className="pf-hero__media"
            fetchPriority="high"
          />
        ) : null}
        <div className="pf-hero__scrim" />
        <div className="pf-hero__inner">
          <p className="pf-hero__kicker">{site?.siteTitle || 'Portafolio'}</p>
          <h1 className="pf-hero__title">{site?.ownerName || 'Fotografía'}</h1>
          {site?.tagline ? (
            <p className="pf-hero__tagline">{site.tagline}</p>
          ) : null}
          <Link href="/trabajo" className="pf-hero__cta">
            Ver el trabajo
          </Link>
        </div>
      </section>

      {site?.bio ? (
        <section className="pf-intro">
          <p>{site.bio}</p>
        </section>
      ) : null}

      <section className="pf-collections">
        <div className="pf-section-head">
          <h2 className="pf-section-title">Colecciones</h2>
          <Link href="/trabajo" className="pf-section-more">
            Todas →
          </Link>
        </div>

        {featured.length === 0 ? (
          <p className="muted">
            Aún no hay colecciones destacadas. Siembra la demo:{' '}
            <code>npx ts-node gallery_backend/scripts/seed-portfolio.ts</code>
          </p>
        ) : (
          <ul className="pf-grid">
            {featured.map((c) => (
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
      </section>
    </main>
  );
}
