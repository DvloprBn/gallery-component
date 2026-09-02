import type { NextConfig } from 'next';

/**
 * Configuración de Next.js.
 *
 * Cuando exista la cuenta de Cloudinary se añadirá su hostname a
 * `images.remotePatterns` para permitir `next/image` con las URLs de
 * entrega. Por ahora la galería no carga imágenes remotas.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
