'use client';

import { useState } from 'react';
import type { Gallery } from '@/lib/gallery-schema';
import { themeToCssVars } from '@/lib/theme';
import { GalleryLayout } from './GalleryLayout';
import { Lightbox } from './Lightbox';

/**
 * Vista completa de una galería pública: aplica el tema del álbum (como CSS
 * custom properties), pinta el layout elegido y gestiona el estado del
 * lightbox.
 *
 * @param props.gallery - La galería (álbum + contenido) ya validada.
 * @param props.backHref - Si se pasa, pinta un enlace de regreso sobre el
 *        título (p. ej. al índice de trabajo).
 */
export function GalleryView({
  gallery,
  backHref,
}: {
  gallery: Gallery;
  backHref?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { album, media } = gallery;

  return (
    <main className="g-root" style={themeToCssVars(album.theme)}>
      <header className="g-header">
        {backHref ? (
          <a href={backHref} className="g-back">
            ← Trabajo
          </a>
        ) : null}
        <h1 className="g-title">{album.title}</h1>
        {album.description ? (
          <p className="g-description">{album.description}</p>
        ) : null}
        <p className="g-meta">
          {album.mediaCount} {album.mediaCount === 1 ? 'elemento' : 'elementos'}
        </p>
      </header>

      {media.length === 0 ? (
        <p className="g-empty">Este álbum todavía no tiene contenido.</p>
      ) : (
        <GalleryLayout gallery={gallery} onOpen={setOpenIndex} />
      )}

      <Lightbox
        media={media}
        index={openIndex}
        onIndexChange={setOpenIndex}
      />
    </main>
  );
}
