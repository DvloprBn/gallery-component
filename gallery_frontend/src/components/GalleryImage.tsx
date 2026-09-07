'use client';

import { useState } from 'react';
import type { GalleryMedia as GalleryMediaData } from '@/lib/gallery-schema';
import { BlurhashCanvas } from './BlurhashCanvas';

/** Orden de preferencia de derivados para construir el `srcset`. */
const VARIANT_ORDER: { key: string; width: number }[] = [
  { key: 'thumb', width: 240 },
  { key: 'small', width: 640 },
  { key: 'medium', width: 1280 },
  { key: 'large', width: 2048 },
];

/**
 * Construye `src` + `srcSet` a partir de los derivados disponibles.
 *
 * @param urls - Mapa `label -> url` de la imagen.
 * @returns `src` (el más grande disponible) y `srcSet` (todos, con su ancho).
 */
function buildSrcSet(urls: Record<string, string>): {
  src: string;
  srcSet: string;
} {
  const available = VARIANT_ORDER.filter((v) => urls[v.key]);
  const srcSet = available.map((v) => `${urls[v.key]} ${v.width}w`).join(', ');
  const src =
    urls.large ?? urls.medium ?? urls.small ?? urls.thumb ?? urls.original;
  return { src, srcSet };
}

/**
 * Una imagen de la galería: el placeholder BlurHash detrás y la imagen real
 * (con `srcset` de los derivados, carga perezosa y decodificación asíncrona)
 * que aparece con un fundido al terminar de cargar.
 *
 * @param props.media - Los datos del elemento (foto o video).
 * @param props.sizes - El atributo `sizes` (lo fija el layout que la contiene).
 * @param props.priority - Si es de las primeras (no perezosa).
 * @param props.onOpen - Se llama al hacer clic (abre el lightbox).
 */
export function GalleryImage({
  media,
  sizes,
  priority = false,
  onOpen,
}: {
  media: GalleryMediaData;
  sizes: string;
  priority?: boolean;
  onOpen?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const { src, srcSet } = buildSrcSet(media.urls);
  const ratio = media.width / media.height;
  const isVideo = media.kind === 'video';

  return (
    <figure
      className="g-figure"
      style={{ aspectRatio: String(ratio) }}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <BlurhashCanvas hash={media.placeholder} />
      <img
        className="g-img"
        src={src}
        srcSet={srcSet || undefined}
        sizes={sizes}
        width={media.width}
        height={media.height}
        alt={media.altText ?? ''}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        data-loaded={loaded}
        draggable={false}
        // Disuasor de copia, no control de acceso real: el archivo que se
        // sirve aquí ya lleva marca de agua y metadatos de derechos
        // incrustados (Fase 11) — eso es lo que protege de verdad.
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      />
      {isVideo ? (
        <span className="g-video-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
          {media.durationMs ? (
            <time className="g-video-dur">{formatDuration(media.durationMs)}</time>
          ) : null}
        </span>
      ) : null}
      {media.caption ? (
        <figcaption className="g-caption">{media.caption}</figcaption>
      ) : null}
    </figure>
  );
}

/** `95000` → `"1:35"`. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
