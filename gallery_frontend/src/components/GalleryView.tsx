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
 * @param props.gallery - La galería (álbum + imágenes) ya validada.
 */
export function GalleryView({ gallery }: { gallery: Gallery }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { album, images } = gallery;

  return (
    <main className="g-root" style={themeToCssVars(album.theme)}>
      <header className="g-header">
        <h1 className="g-title">{album.title}</h1>
        {album.description ? (
          <p className="g-description">{album.description}</p>
        ) : null}
        <p className="g-meta">
          {album.imageCount} {album.imageCount === 1 ? 'imagen' : 'imágenes'}
        </p>
      </header>

      {images.length === 0 ? (
        <p className="g-empty">Este álbum todavía no tiene imágenes.</p>
      ) : (
        <GalleryLayout gallery={gallery} onOpen={setOpenIndex} />
      )}

      <Lightbox
        images={images}
        index={openIndex}
        onIndexChange={setOpenIndex}
      />
    </main>
  );
}
