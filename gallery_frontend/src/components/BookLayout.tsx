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
  const coverBg =
    media[0]?.urls.medium ?? media[0]?.urls.small ?? media[0]?.urls.large;
  const [mode, setMode] = useState<Mode>('static');
  const [page, setPage] = useState(0);
  const [leafCount, setLeafCount] = useState(0);
  // ¿El libro está abierto (se pasó de la portada)? Arranca cerrado.
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);

  // (1) Decidir: menos movimiento → `grid`; si no, intentar `flip`.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMode(mq.matches ? 'grid' : 'flip');
  }, []);

  // (2) En modo `flip`, montar `page-flip` sobre las hojas planas.
  //  El libro es INDEPENDIENTE del scroll (decisión del dueño, Fase 15g): no
  //  fija la pantalla ni obliga a hojearlo entero. Se pasa página con
  //  arrastre, con los botones ‹ ›, o con las flechas cuando el libro tiene
  //  el foco. Arranca cerrado (portada) y se abre con la portada / un botón.
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
          height: 733, // hoja 3:4 → pliego 3:2
          size: 'stretch',
          minWidth: 300,
          maxWidth: 760,
          minHeight: 400,
          maxHeight: 1040,
          maxShadowOpacity: 0.7,
          drawShadow: true,
          flippingTime: 800, // giro con peso
          showCover: true,
          showPageCorners: true, // esquina que se despega al pasar el ratón
          usePortrait: true, // móvil: una página, swipe
          // En táctil, el scroll vertical de la PÁGINA pasa por encima del
          // libro (no lo secuestra) — el giro es gesto horizontal / botones.
          mobileScrollSupport: true,
          // El clic NO pasa página (eso es arrastre + botones); así un toque
          // sobre la hoja abre el lightbox sin ambigüedad.
          disableFlipByClick: true,
          useMouseEvents: true,
          swipeDistance: 20,
        });
        instance.loadFromHTML(host.querySelectorAll('.g-book__leaf'));
        flipRef.current = instance;
        setLeafCount(instance.getPageCount());
        const p0 = instance.getCurrentPageIndex();
        setPage(p0);
        setOpen(p0 > 0);

        ro = new ResizeObserver(() => {
          try {
            instance?.update();
          } catch {
            /* el observer puede disparar durante el desmontaje */
          }
        });
        ro.observe(hostRef.current);

        const eagerAround = (idx: number) => {
          const imgs = host.querySelectorAll<HTMLImageElement>(
            '.g-book__leaf img',
          );
          for (const n of [idx, idx + 1, idx + 2]) {
            const img = imgs[n - 1];
            if (img && img.loading === 'lazy') img.loading = 'eager';
          }
        };

        onFlip = (e: { data: unknown }) => {
          const p =
            typeof e.data === 'number'
              ? e.data
              : instance!.getCurrentPageIndex();
          setPage(p);
          setOpen(p > 0);
          eagerAround(p);
        };
        instance.on('flip', onFlip);

        // Flechas: solo cuando el foco está DENTRO del libro (el evento
        // burbujea desde los botones/hojas). No hay listener global — el
        // libro nunca secuestra las flechas de la página.
        onKey = (ev: KeyboardEvent) => {
          if (document.querySelector('.g-lightbox.is-open')) return;
          if (ev.key === 'ArrowRight' || ev.key === 'PageDown') {
            ev.preventDefault();
            instance!.flipNext();
          } else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
            ev.preventDefault();
            instance!.flipPrev();
          }
        };
        rootRef.current?.addEventListener('keydown', onKey);
      } catch {
        if (!cancelled) setMode('grid');
      }
    };

    let onKey: ((ev: KeyboardEvent) => void) | null = null;
    let onFlip: ((e: { data: unknown }) => void) | null = null;
    const root = rootRef.current;
    void start();

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (onKey) root?.removeEventListener('keydown', onKey);
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
      <div
        className="g-book"
        role="region"
        aria-label={`Fotolibro: ${album.title}`}
      >
        <BookCover album={album} bg={coverBg} count={media.length} />
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

  // ── Fotolibro con pase de página (page-flip) — independiente del scroll ────
  const needsBlank = media.length % 2 === 1; // deja la contraportada sola
  const shownLeaves = leafCount || 2 + media.length + (needsBlank ? 1 : 0);
  const openBook = () => flipRef.current?.flipNext();
  return (
    <div
      className="g-book g-book--flip"
      ref={rootRef}
      role="region"
      aria-roledescription="fotolibro"
      aria-label={
        open
          ? `Fotolibro: ${album.title}. Página ${Math.min(
              page + 1,
              shownLeaves,
            )} de ${shownLeaves}.`
          : `Fotolibro: ${album.title}. Cerrado — actívalo para abrirlo.`
      }
    >
      {/* Cuerpo del libro: tapas, lomo, canto y sombra alrededor de
          `page-flip` — todo decorativo. `--book-page` / `--book-count`
          mueven el grosor de cada taco de hojas según por dónde vas. */}
      <div
        className="g-book__body"
        data-open={open ? 'true' : 'false'}
        style={
          {
            '--book-page': Math.min(page, shownLeaves),
            '--book-count': shownLeaves,
          } as React.CSSProperties
        }
      >
        <span className="g-book__board g-book__board--l" aria-hidden="true" />
        <span className="g-book__board g-book__board--r" aria-hidden="true" />
        <span className="g-book__spine" aria-hidden="true" />
        <span className="g-book__shadow" aria-hidden="true" />
        <div className="g-book__flip" ref={hostRef}>
          <div className="g-book__leaf g-book__leaf--cover" data-density="hard">
            <BookCover album={album} bg={coverBg} count={media.length} />
            {/* Tocar la portada abre el libro. Siempre en el DOM (page-flip
                reubica la hoja); se desactiva con `hidden` una vez abierto. */}
            <button
              type="button"
              className="g-book__open"
              hidden={open}
              aria-label="Abrir libro"
              onClick={openBook}
            >
              <span className="g-book__open-label">Abrir libro</span>
            </button>
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
            <div
              className="g-book__leaf g-book__leaf--blank"
              aria-hidden="true"
            />
          ) : null}
          <div className="g-book__leaf g-book__leaf--cover" data-density="hard">
            <BookBack />
          </div>
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
        <span className="g-book__progress" aria-live="polite">
          {open ? `${Math.min(page + 1, shownLeaves)} / ${shownLeaves}` : 'Cerrado'}
        </span>
        <button
          type="button"
          className="g-book__nav"
          aria-label={open ? 'Página siguiente' : 'Abrir libro'}
          onClick={openBook}
        >
          ›
        </button>
      </div>
    </div>
  );
}

/**
 * Portada: título + descripción del álbum con la tipografía y el acento del
 * `theme`, y la primera imagen atenuada de fondo.
 */
function BookCover({
  album,
  bg,
  count,
}: {
  album: Gallery['album'];
  bg?: string;
  count: number;
}) {
  return (
    <div className="g-book__cover">
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="g-book__cover-bg" src={bg} alt="" aria-hidden="true" loading="lazy" />
      ) : null}
      <div className="g-book__cover-inner">
        <span className="g-book__kicker">Fotolibro</span>
        <h2 className="g-book__title">{album.title}</h2>
        {album.description ? (
          <p className="g-book__sub">{album.description}</p>
        ) : null}
        <span className="g-book__count">
          {count} {count === 1 ? 'pieza' : 'piezas'}
        </span>
      </div>
    </div>
  );
}

/** Contraportada: cierre + CTA de licencia. */
function BookBack() {
  return (
    <div className="g-book__back">
      <span className="g-book__fin">Fin</span>
      <p className="g-book__back-text">
        ¿Te interesó alguna imagen? Puedo licenciártela para tu proyecto.
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
