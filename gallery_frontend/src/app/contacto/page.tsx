import type { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';
import { fetchSite } from '@/lib/api';

/** Datos en vivo — no se prerenderiza en build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacto',
  description: 'Escríbeme para encargos, prensa o colaboraciones.',
};

/**
 * Página de contacto: la introducción configurable del sitio, los datos
 * directos (correo, Instagram) y el formulario.
 */
export default async function ContactoPage() {
  const site = await fetchSite();

  const instagramUrl = site?.instagram
    ? site.instagram.startsWith('http')
      ? site.instagram
      : `https://instagram.com/${site.instagram.replace(/^@/, '')}`
    : null;

  return (
    <main className="pf pf-page pf-contact">
      <header className="pf-page__head">
        <h1 className="pf-page__title">Contacto</h1>
        {site?.contactIntro ? (
          <p className="pf-page__lead">{site.contactIntro}</p>
        ) : null}
      </header>

      <div className="pf-contact__grid">
        <ContactForm />

        <aside className="pf-contact__aside">
          {site?.contactEmail ? (
            <p>
              <span className="pf-contact__label">Correo</span>
              <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
            </p>
          ) : null}
          {instagramUrl ? (
            <p>
              <span className="pf-contact__label">Instagram</span>
              <a href={instagramUrl} target="_blank" rel="noreferrer">
                {site?.instagram}
              </a>
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
