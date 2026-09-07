'use client';

import { useEffect, useRef } from 'react';
import type { Gallery, GalleryMedia as GalleryMediaData } from '@/lib/gallery-schema';
import {
  motionDuration,
  motionPreset,
  motionStagger,
} from '@/lib/theme';
import { GalleryImage } from './GalleryImage';

type Layout = Gallery['album']['layout'];

/** `sizes` (media queries de ancho de imagen) por layout — guía al navegador a elegir el derivado. */
const SIZES_BY_LAYOUT: Record<Layout, string> = {
  masonry: '(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 33vw',
  grid: '(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 25vw',
  justified: '(max-width: 600px) 100vw, 40vw',
  carousel: '(max-width: 600px) 85vw, 60vw',
  // `book` lo renderiza `BookLayout`, no este componente; el `sizes` es el
  // que usan sus páginas (una hoja ≈ media anchura del libro).
  book: '(max-width: 700px) 92vw, 46vw',
};

/**
 * Renderiza la rejilla de imágenes según el layout del álbum (masonry / grid /
 * justified / carousel) y revela cada imagen con una animación CSS cuando
 * entra en el viewport (una sola vez, vía `IntersectionObserver`).
 *
 * La animación es 100% CSS — no hay librería de animación en el bundle. El
 * preset (`fade-up`/`fade`/`zoom`) se pasa como `data-preset` y el retardo
 * escalonado como `--reveal-delay`. Con `prefers-reduced-motion` no se
 * observa nada: todo aparece visible de inmediato.
 *
 * @param props.gallery - La galería completa (álbum + imágenes).
 * @param props.onOpen - Abre el lightbox en el índice dado.
 */
export function GalleryLayout({
  gallery,
  onOpen,
}: {
  gallery: Gallery;
  onOpen: (index: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { layout, theme } = gallery.album;
  const preset = motionPreset(theme);
  const stagger = motionStagger(theme);
  const duration = motionDuration(theme);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>('.g-item'),
    );

    if (prefersReduced || preset === 'none') {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [preset, gallery.media.length]);

  const item = (media: GalleryMediaData, index: number) => (
    <div
      key={media.mediaId}
      className="g-item g-reveal"
      data-preset={preset}
      style={
        {
          '--reveal-delay': `${(index % 4) * stagger}s`,
          '--reveal-duration': `${duration}s`,
          ...(layout === 'justified'
            ? {
                flexGrow: media.width / media.height,
                flexBasis: `${(media.width / media.height) * 240}px`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <GalleryImage
        media={media}
        sizes={SIZES_BY_LAYOUT[layout]}
        priority={index < 3}
        onOpen={() => onOpen(index)}
      />
    </div>
  );

  return (
    <div ref={rootRef} className={`g-layout g-layout--${layout}`}>
      {gallery.media.map(item)}
    </div>
  );
}
