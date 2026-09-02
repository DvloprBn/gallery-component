import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { SiteNav } from '@/components/SiteNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Galería',
  description:
    'Galería de imágenes con personalización y animaciones de grado profesional.',
};

/**
 * Layout raíz. Envuelve todo en `<AuthProvider>` (estado de sesión) y pinta la
 * barra de navegación del sitio.
 *
 * @param props.children - El árbol de la ruta activa.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <SiteNav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
