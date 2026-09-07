import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Origen (esquema + host + puerto) de la API, si `NEXT_PUBLIC_API_BASE_URL`
 * es una URL absoluta (en desarrollo: `http://localhost:3050`). En producción
 * la API es del mismo origen (`/api`), así que devuelve `''`.
 */
function apiOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  try {
    return base.startsWith('http') ? new URL(base).origin : '';
  } catch {
    return '';
  }
}

/**
 * Content-Security-Policy. `'unsafe-inline'` en `style-src` es necesario
 * (Next inyecta CSS crítico y la galería usa `style={}` para las variables de
 * tema); en `script-src` es el precio de no montar un flujo de nonces — aun
 * así bloquea la carga de scripts externos, el framing y la exfiltración a
 * orígenes no listados. En desarrollo se añade `'unsafe-eval'` y `ws:` para
 * el hot-reload.
 */
function contentSecurityPolicy(): string {
  const api = apiOrigin();
  const dev = isProd ? '' : " 'unsafe-eval'";
  const devConnect = isProd ? '' : ' ws: http://localhost:*';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    `img-src 'self' data: blob: https://res.cloudinary.com ${api}`.trim(),
    // El <video> del lightbox carga el preview desde el mismo origen que la API
    // (en dev, otro puerto; en prod, `/api` del mismo host) o desde Cloudinary.
    `media-src 'self' blob: https://res.cloudinary.com ${api}`.trim(),
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${dev}`,
    `connect-src 'self' ${api}${devConnect}`.trim(),
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * Configuración de Next.js.
 *
 * `output: 'standalone'` empaqueta el servidor + solo las dependencias que
 * usa — la imagen de producción se queda muy pequeña.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  /** Cabeceras de seguridad para TODAS las respuestas del frontend. */
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
      { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
    ];
    if (isProd) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
