import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { SiteProvider } from '@/lib/site';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { fetchSite } from '@/lib/api';
import './globals.css';

/** Datos en vivo — el layout lee la identidad del sitio en cada petición. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'Portafolio de fotografía',
    template: '%s · Portafolio',
  },
  description:
    'Portafolio de fotografía documental — colecciones, personalización de galería y animaciones que respetan prefers-reduced-motion.',
};

/**
 * Layout raíz. Resuelve la identidad del sitio en el servidor y la reparte por
 * contexto; envuelve todo en el estado de sesión y pinta la cabecera y el pie.
 *
 * @param props.children - El árbol de la ruta activa.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const site = await fetchSite();

  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <SiteProvider initial={site}>
            <SiteHeader />
            {children}
            <SiteFooter />
          </SiteProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
