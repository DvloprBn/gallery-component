'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryMedia } from '@/lib/gallery-schema';
import { useSite } from '@/lib/site';
import { loadHls } from '@/lib/load-hls';
import { LicenseRequestForm } from './LicenseRequestForm';

/**
 * Visor a pantalla completa. Se abre desde una imagen de la galería; permite
 * avanzar/retroceder con las flechas o los botones y cerrar con Escape o
 * clic en el fondo. Las transiciones son CSS (clase `is-open`); no hay
 * librería de animación. `prefers-reduced-motion` lo neutraliza el CSS global.
 *
 * @param props.media - Lista completa del contenido de la galería.
 * @param props.index - Índice abierto, o `null` si está cerrado.
 * @param props.onIndexChange - Cambia el índice (o `null` para cerrar).
 */
export function Lightbox({
  media,
  index,
  onIndexChange,
}: {
  media: GalleryMedia[];
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
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // Reproducción del video abierto: HLS adaptativo si el navegador lo soporta
  // (nativo en Safari, vía `hls.js` en el resto); si no, el `preview` MP4.
  const openMedia = index !== null ? media[index] : undefined;
  const hlsUrl = openMedia?.kind === 'video' ? openMedia.urls.hls : undefined;
  const previewUrl = openMedia?.kind === 'video' ? openMedia.urls.preview : undefined;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || openMedia?.kind !== 'video') return;

    if (!hlsUrl) {
      if (previewUrl) el.src = previewUrl;
      return;
    }
    // Safari (y iOS) reproducen HLS de forma nativa.
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = hlsUrl;
      return;
    }
    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    loadHls()
      .then((Hls) => {
        if (destroyed || !videoRef.current) return;
        if (!Hls.isSupported()) {
          if (previewUrl) videoRef.current.src = previewUrl;
          return;
        }
        const instance = new Hls({ enableWorker: false });
        hls = instance;
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && previewUrl && videoRef.current) {
            instance.destroy();
            hls = null;
            videoRef.current.src = previewUrl;
          }
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(videoRef.current);
      })
      .catch(() => {
        if (!destroyed && previewUrl && videoRef.current) {
          videoRef.current.src = previewUrl;
        }
      });
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [hlsUrl, previewUrl, openMedia?.kind]);

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndexChange((index + delta + media.length) % media.length);
    },
    [index, media.length, onIndexChange],
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
  const current = index !== null ? media[index] : media[0];

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
        {current.kind === 'video' ? (
          <video
            key={current.mediaId}
            ref={videoRef}
            className="g-lightbox-img"
            poster={current.urls.large ?? current.urls.medium}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            onContextMenu={(event) => event.preventDefault()}
          />
        ) : (
          <img
            key={current.mediaId}
            className="g-lightbox-img"
            src={current.urls.large ?? current.urls.medium ?? current.urls.original}
            alt={current.altText ?? ''}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
        {current.caption ? (
          <figcaption className="g-lightbox-caption">{current.caption}</figcaption>
        ) : null}
        {site.rights.noticeText ? (
          <p className="g-lightbox-rights">{site.rights.noticeText}</p>
        ) : null}
        {showLicenseForm ? (
          <LicenseRequestForm
            mediaId={current.mediaId}
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
          {index + 1} / {media.length}
        </span>
      ) : null}
    </div>
  );
}
