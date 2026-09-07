'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import type { Gallery, GalleryMedia } from '@/lib/gallery-schema';
import { GalleryImage } from './GalleryImage';
import { GalleryLayout } from './GalleryLayout';

/** `sizes` de una hoja del libro (≈ media anchura del libro abierto). */
const PAGE_SIZES = '(max-width: 700px) 92vw, 46vw';

/**
 * - `static`: el fotolibro plano (15a). Es lo que pinta el SSR y lo que queda
 *   si no hay JS. Accesible, sin animación.
 * - `flip`: `page-flip` (StPageFlip) montado sobre las hojas — el pase de
 *   página fotorrealista con arrastre (15b).
 * - `grid`: caída a la rejilla normal — con `prefers-reduced-motion` o si
 *   `page-flip` no carga / falla al iniciar.
 */
type Mode = 'static' | 'flip' | 'grid';

/** Agrupa los medios en pliegos de dos (para el modo `static`). */
function toSpreads(
  media: GalleryMedia[],
): { left: GalleryMedia; right: GalleryMedia | null }[] {
  const out: { left: GalleryMedia; right: GalleryMedia | null }[] = [];
  for (let i = 0; i < media.length; i += 2) {
    out.push({ left: media[i], right: media[i + 1] ?? null });
  }
  return out;
}

/**
 * Layout **"libro"** (Fase 15). El SSR pinta un fotolibro plano; en el cliente,
 * si el visitante no pidió menos movimiento y `page-flip` carga, se "mejora" a
 * un libro con pase de página real (arrastre + botones). El scroll fijo que
 * pasa las páginas solo llega en la 15c.
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
  const [mode, setMode] = useState<Mode>('static');
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);

  // (1) Decidir: menos movimiento → `grid`; si no, intentar `flip`.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMode(mq.matches ? 'grid' : 'flip');
  }, []);

  // (2) En modo `flip`, montar `page-flip` sobre las hojas planas.
  useEffect(() => {
    if (mode !== 'flip') return;
    let cancelled = false;
    let instance: PageFlip | null = null;
    let ro: ResizeObserver | null = null;

    const start = async () => {
      const host = hostRef.current;
      if (!host || host.clientWidth === 0) {
        // El layout aún no tiene ancho (hidratación) — reintenta en el frame siguiente.
        if (!cancelled) requestAnimationFrame(() => void start());
        return;
      }
      const leaves = host.querySelectorAll('.g-book__leaf');
      if (leaves.length === 0) return;
      try {
        const mod = await import('page-flip/dist/js/page-flip.module.js');
        // Algunos empaquetadores envuelven el módulo en `.default`.
        const PF =
          mod.PageFlip ??
          (mod as unknown as { default?: { PageFlip?: typeof mod.PageFlip } })
            .default?.PageFlip;
        if (cancelled || !hostRef.current) return;
        if (!PF) {
          setMode('grid');
          return;
        }
        instance = new PF(hostRef.current, {
          width: 550,
          height: 730, // hoja 3:4 → pliego 3:2
          size: 'stretch',
          minWidth: 280,
          maxWidth: 720,
          minHeight: 380,
          maxHeight: 1000,
          maxShadowOpacity: 0.5,
          drawShadow: true,
          flippingTime: 700,
          showCover: true,
          mobileScrollSupport: true,
          // El clic NO pasa página (eso es arrastre + botones); así un toque
          // sobre la hoja abre el lightbox sin ambigüedad.
          disableFlipByClick: true,
          useMouseEvents: true,
        });
        instance.loadFromHTML(host.querySelectorAll('.g-book__leaf'));
        flipRef.current = instance;
        ro = new ResizeObserver(() => {
          try {
            instance?.update();
          } catch {
            /* el observer puede disparar durante el desmontaje */
          }
        });
        ro.observe(hostRef.current);
      } catch {
        if (!cancelled) setMode('grid');
      }
    };
    void start();

    return () => {
      cancelled = true;
      ro?.disconnect();
      try {
        instance?.destroy();
      } catch {
        /* noop */
      }
      flipRef.current = null;
    };
  }, [mode]);

  // ── Caída a la rejilla ────────────────────────────────────────────────────
  if (mode === 'grid') {
    return (
      <GalleryLayout
        gallery={{ ...gallery, album: { ...album, layout: 'grid' } }}
        onOpen={onOpen}
      />
    );
  }

  // ── Fotolibro plano (SSR / sin JS) ────────────────────────────────────────
  if (mode === 'static') {
    const spreads = toSpreads(media);
    return (
      <div className="g-book">
        <BookCover album={album} />
        {spreads.map((s, si) => (
          <div className="g-book__spread" key={s.left.mediaId}>
            <StaticPage media={s.left} index={si * 2} folio={si * 2 + 1} onOpen={onOpen} priority={si === 0} />
            {s.right ? (
              <StaticPage media={s.right} index={si * 2 + 1} folio={si * 2 + 2} onOpen={onOpen} priority={si === 0} />
            ) : (
              <div className="g-book__page g-book__page--blank" aria-hidden="true" />
            )}
          </div>
        ))}
        <BookBack />
      </div>
    );
  }

  // ── Fotolibro con pase de página (page-flip) ──────────────────────────────
  const needsBlank = media.length % 2 === 1; // deja la contraportada sola
  return (
    <div className="g-book g-book--flip">
      <div className="g-book__flip" ref={hostRef}>
        <div className="g-book__leaf g-book__leaf--cover" data-density="hard">
          <BookCover album={album} />
        </div>
        {media.map((m, i) => (
          <div className="g-book__leaf" key={m.mediaId}>
            <span className="g-book__folio">{i + 1}</span>
            <GalleryImage media={m} sizes={PAGE_SIZES} priority={i < 2} />
            <button
              type="button"
              className="g-book__leaf-btn"
              aria-label="Ver ampliada"
              onClick={() => onOpen(i)}
            />
          </div>
        ))}
        {needsBlank ? (
          <div className="g-book__leaf g-book__leaf--blank" aria-hidden="true" />
        ) : null}
        <div className="g-book__leaf g-book__leaf--cover" data-density="hard">
          <BookBack />
        </div>
      </div>

      <div className="g-book__controls">
        <button
          type="button"
          className="g-book__nav"
          aria-label="Página anterior"
          onClick={() => flipRef.current?.flipPrev()}
        >
          ‹
        </button>
        <span className="g-book__hint">Arrastra la esquina para pasar la página</span>
        <button
          type="button"
          className="g-book__nav"
          aria-label="Página siguiente"
          onClick={() => flipRef.current?.flipNext()}
        >
          ›
        </button>
      </div>
    </div>
  );
}

/** Portada: título + descripción del álbum, con el acento del `theme`. */
function BookCover({ album }: { album: Gallery['album'] }) {
  return (
    <div className="g-book__cover">
      <span className="g-book__kicker">Fotolibro</span>
      <h2 className="g-book__title">{album.title}</h2>
      {album.description ? (
        <p className="g-book__sub">{album.description}</p>
      ) : null}
    </div>
  );
}

/** Contraportada: CTA de licencia. */
function BookBack() {
  return (
    <div className="g-book__back">
      <p className="g-book__back-text">
        ¿Te interesa alguna imagen de esta colección?
      </p>
      <Link href="/contacto" className="g-book__cta">
        Solicitar una licencia
      </Link>
    </div>
  );
}

/** Una hoja del fotolibro plano (modo `static`): imagen + folio, clic → lightbox. */
function StaticPage({
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
