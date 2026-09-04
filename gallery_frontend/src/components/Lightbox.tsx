'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GalleryImage } from '@/lib/gallery-schema';
import { useSite } from '@/lib/site';
import { LicenseRequestForm } from './LicenseRequestForm';

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
  const site = useSite();
  const isOpen = index !== null;
  // `mounted` mantiene el nodo un instante tras cerrar, para la transición de salida.
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  // Panel de "Solicitar licencia" (Fase 12d) — se cierra solo al cambiar de foto.
  const [showLicenseForm, setShowLicenseForm] = useState(false);

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

  // Cambiar de foto (o cerrar) descarta cualquier solicitud a medio llenar.
  useEffect(() => {
    setShowLicenseForm(false);
  }, [index]);

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
      <figure className="g-lightbox-frame" onClick={(event) => event.stopPropagation()}>
        <img
          key={current.imageId}
          className="g-lightbox-img"
          src={current.urls.large ?? current.urls.medium ?? current.urls.original}
          alt={current.altText ?? ''}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        />
        {current.caption ? (
          <figcaption className="g-lightbox-caption">{current.caption}</figcaption>
        ) : null}
        {site.rights.noticeText ? (
          <p className="g-lightbox-rights">{site.rights.noticeText}</p>
        ) : null}
        {showLicenseForm ? (
          <LicenseRequestForm
            imageId={current.imageId}
            onClose={() => setShowLicenseForm(false)}
          />
        ) : (
          <button
            type="button"
            className="g-lightbox-license-toggle"
            onClick={() => setShowLicenseForm(true)}
          >
            Solicitar licencia
          </button>
        )}
      </figure>
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
      {index !== null ? (
        <span className="g-lightbox-count">
          {index + 1} / {images.length}
        </span>
      ) : null}
    </div>
  );
}
