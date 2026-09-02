'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSite } from '@/lib/site';

/**
 * Pie del sitio: nombre del autor, enlaces a redes / contacto y una nota de que
 * esto es una pieza de demostración. Se oculta dentro de una colección
 * (`/g/...`) para no romper la vista de la galería.
 */
export function SiteFooter() {
  const pathname = usePathname();
  const site = useSite();

  if (pathname.startsWith('/g/')) {
    return null;
  }

  const year = new Date().getFullYear();
  const instagramUrl = site.instagram
    ? site.instagram.startsWith('http')
      ? site.instagram
      : `https://instagram.com/${site.instagram.replace(/^@/, '')}`
    : null;

  return (
    <footer className="site-footer">
      <div className="site-footer__row">
        <span className="site-footer__brand">{site.ownerName || 'Estudio'}</span>
        <nav className="site-footer__links">
          <Link href="/trabajo">Trabajo</Link>
          <Link href="/sobre">Sobre</Link>
          <Link href="/contacto">Contacto</Link>
          {instagramUrl ? (
            <a href={instagramUrl} target="_blank" rel="noreferrer">
              Instagram
            </a>
          ) : null}
        </nav>
      </div>
      <p className="site-footer__note">
        © {year} {site.ownerName || 'Estudio'}. Pieza de demostración del
        portafolio — personas, marcas y encargos son ficticios.
      </p>
    </footer>
  );
}
