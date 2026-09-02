import type { Metadata } from 'next';
import Link from 'next/link';
import { BlurhashCanvas } from '@/components/BlurhashCanvas';
import { fetchSite } from '@/lib/api';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sobre',
  description: 'Quién está detrás de la cámara.',
};

/**
 * Selección de encargos / publicaciones. Es contenido de demostración fijo —
 * el proyecto no tiene clientes reales — y sirve para mostrar cómo se vería la
 * página con una trayectoria detrás.
 */
const ENCARGOS = [
  'Revista Cauce — ensayo sobre patinaje urbano (2024)',
  'Festival de Arte Público de Querétaro — cobertura oficial (2023)',
  'Colectivo Tinta Viva — serie de retrato de oficio (2023)',
  'Editorial Marca de Agua — portada de "Ciudad a pie" (2022)',
];

/**
 * Página "Sobre": retrato (reutiliza el hero si hay), el texto largo del sitio
 * partido en párrafos, la selección de encargos y una llamada a contacto.
 */
export default async function SobrePage() {
  const site = await fetchSite();

  const paragraphs = (site?.aboutBody ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const portraitUrl = site?.hero
    ? site.hero.urls.medium ?? site.hero.urls.small ?? site.hero.urls.original
    : null;

  return (
    <main className="pf pf-page pf-about">
      <div className="pf-about__grid">
        <div className="pf-about__portrait">
          {site?.hero ? <BlurhashCanvas hash={site.hero.placeholder} /> : null}
          {portraitUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={portraitUrl} alt={site?.ownerName ?? ''} loading="lazy" />
          ) : (
            <span className="pf-about__portrait--empty" />
          )}
        </div>

        <div className="pf-about__text">
          <h1 className="pf-page__title">{site?.ownerName || 'Sobre'}</h1>
          {site?.tagline ? (
            <p className="pf-page__lead">{site.tagline}</p>
          ) : null}

          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => <p key={i}>{p}</p>)
          ) : site?.bio ? (
            <p>{site.bio}</p>
          ) : (
            <p className="muted">Aún no hay texto en «Sobre».</p>
          )}

          <h2 className="pf-about__subhead">Selección de encargos</h2>
          <ul className="pf-about__list">
            {ENCARGOS.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>

          <p className="pf-about__cta">
            ¿Un proyecto en mente?{' '}
            <Link href="/contacto">Escríbeme</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
