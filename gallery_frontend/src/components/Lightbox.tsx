'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GalleryImage } from '@/lib/gallery-schema';

/**
 * Visor a pantalla completa. Se abre desde una imagen de la galería; permite
 * avanzar/retroceder con las flechas o los botones y cerrar con Escape o
 * clic en el fondo. Las transiciones son CSS (clase `is-open`); no hay
 * librería de animación. `prefers-reduced-motion` lo neutraliza el CSS global.
 *
 * @param props.images - Lista completa de imágenes de la galería.
 * @param props.index - Índice abierto, o `null` si está cerrado.
 * @param props.onIndexChange - Cambia el índice (o `null` para cerrar).
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
}: {
  images: GalleryImage[];
  index: number | null;
  onIndexChange: (next: number | null) => void;
}) {
  const isOpen = index !== null;
  // `mounted` mantiene el nodo un instante tras cerrar, para la transición de salida.
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [index, images.length, onIndexChange],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onIndexChange(null);
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, go, onIndexChange]);

  if (!mounted) return null;
  const current = index !== null ? images[index] : images[0];

  return (
    <div
      className={`g-lightbox${visible ? ' is-open' : ''}`}
      onClick={() => onIndexChange(null)}
      role="dialog"
      aria-modal="true"
      aria-label={current.altText ?? 'Imagen ampliada'}
    >
      <button
        className="g-lightbox-close"
        aria-label="Cerrar"
        onClick={(event) => {
          event.stopPropagation();
          onIndexChange(null);
        }}
      >
        ×
      </button>
      <button
        className="g-lightbox-nav g-prev"
        aria-label="Anterior"
        onClick={(event) => {
          event.stopPropagation();
          go(-1);
        }}
      >
        ‹
      </button>
      <img
        key={current.imageId}
        className="g-lightbox-img"
        src={current.urls.large ?? current.urls.medium ?? current.urls.original}
        alt={current.altText ?? ''}
        onClick={(event) => event.stopPropagation()}
      />
      <button
        className="g-lightbox-nav g-next"
        aria-label="Siguiente"
        onClick={(event) => {
          event.stopPropagation();
          go(1);
        }}
      >
        ›
      </button>
      {current.caption ? (
        <p className="g-lightbox-caption">{current.caption}</p>
      ) : null}
    </div>
  );
}
