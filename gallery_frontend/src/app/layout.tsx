import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Galería',
  description:
    'Galería de imágenes con personalización y animaciones de grado profesional.',
};

/**
 * Layout raíz de la aplicación — envuelve todas las páginas.
 *
 * @param props.children - El árbol de la ruta activa.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
