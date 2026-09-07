'use client';

import Link from 'next/link';
import type { Gallery, GalleryMedia } from '@/lib/gallery-schema';
import { GalleryImage } from './GalleryImage';

/** `sizes` de una hoja del libro (≈ media anchura del libro abierto). */
const PAGE_SIZES = '(max-width: 700px) 92vw, 46vw';

/** Agrupa los medios en **pliegos** de dos (hoja izquierda / hoja derecha). */
function toSpreads(
  media: GalleryMedia[],
): { left: GalleryMedia; right: GalleryMedia | null }[] {
  const spreads: { left: GalleryMedia; right: GalleryMedia | null }[] = [];
  for (let i = 0; i < media.length; i += 2) {
    spreads.push({ left: media[i], right: media[i + 1] ?? null });
  }
  return spreads;
}

/**
 * Layout **"libro"** (Fase 15a): un fotolibro con portada, pliegos de dos
 * imágenes y contraportada. En esta sub-fase es **estático** — sin giro de
 * página ni scroll fijo (llegan en 15b/15c). Es la base accesible: funciona
 * sin JS, y en móvil cae a una hoja por pantalla (solo CSS).
 *
 * @param props.gallery - La galería (álbum + medios) ya validada.
 * @param props.onOpen - Abre el lightbox en el índice dado (al tocar una hoja).
 */
export function BookLayout({
  gallery,
  onOpen,
}: {
  gallery: Gallery;
  onOpen: (index: number) => void;
}) {
  const { album, media } = gallery;
  const spreads = toSpreads(media);

  return (
    <div className="g-book">
      <div className="g-book__cover">
        <span className="g-book__kicker">Fotolibro</span>
        <h2 className="g-book__title">{album.title}</h2>
        {album.description ? (
          <p className="g-book__sub">{album.description}</p>
        ) : null}
      </div>

      {spreads.map((spread, si) => (
        <div className="g-book__spread" key={spread.left.mediaId}>
          <BookPage
            media={spread.left}
            index={si * 2}
            folio={si * 2 + 1}
            priority={si === 0}
            onOpen={onOpen}
          />
          {spread.right ? (
            <BookPage
              media={spread.right}
              index={si * 2 + 1}
              folio={si * 2 + 2}
              priority={si === 0}
              onOpen={onOpen}
            />
          ) : (
            <div className="g-book__page g-book__page--blank" aria-hidden="true" />
          )}
        </div>
      ))}

      <div className="g-book__back">
        <p className="g-book__back-text">
          ¿Te interesa alguna imagen de esta colección?
        </p>
        <Link href="/contacto" className="g-book__cta">
          Solicitar una licencia
        </Link>
      </div>
    </div>
  );
}

/** Una hoja del libro: la imagen (reutiliza `GalleryImage`) + el número de folio. */
function BookPage({
  media,
  index,
  folio,
  priority,
  onOpen,
}: {
  media: GalleryMedia;
  index: number;
  folio: number;
  priority: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="g-book__page">
      <GalleryImage
        media={media}
        sizes={PAGE_SIZES}
        priority={priority}
        onOpen={() => onOpen(index)}
      />
      <span className="g-book__folio">{folio}</span>
    </div>
  );
}
