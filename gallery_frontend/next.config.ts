import type { NextConfig } from 'next';

/**
 * Configuración de Next.js.
 *
 * `output: 'standalone'` empaqueta el servidor + solo las dependencias que usa
 * en `.next/standalone/` — la imagen de producción se queda muy pequeña.
 *
 * Cuando exista la cuenta de Cloudinary se añadirá su hostname a
 * `images.remotePatterns` (por ahora las imágenes se sirven como `<img>`
 * normales con `srcset`, sin el optimizador de `next/image`).
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
