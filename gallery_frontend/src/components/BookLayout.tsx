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
  const hostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
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
        const count = instance.getPageCount();
        setLeafCount(count);
        setPage(instance.getCurrentPageIndex());

        ro = new ResizeObserver(() => {
          try {
            instance?.update();
          } catch {
            /* el observer puede disparar durante el desmontaje */
          }
        });
        ro.observe(hostRef.current);

        // ── Scroll fijo: la sección se queda pegada y el progreso de scroll
        //    pasa las páginas. Solo en escritorio y sin `prefers-reduced-motion`
        //    (en móvil el pin pelea con el scroll nativo). ──
        const pinnable = () =>
          window.matchMedia('(min-width: 701px)').matches &&
          window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

        let raf = 0;
        let pinned = false;
        const fromScroll = { active: false };
        let lastTarget = -1;

        const eagerAround = (idx: number) => {
          const imgs = host.querySelectorAll<HTMLImageElement>('.g-book__leaf img');
          for (const n of [idx, idx + 1, idx + 2]) {
            const img = imgs[n - 1];
            if (img && img.loading === 'lazy') img.loading = 'eager';
          }
        };

        const scrollToPage = (p: number) => {
          const track = trackRef.current;
          if (!track) return;
          const total = track.offsetHeight - window.innerHeight;
          const frac = count > 1 ? p / (count - 1) : 0;
          window.scrollTo({
            top: track.offsetTop + Math.max(0, frac * total),
            behavior: 'smooth',
          });
        };

        onFlip = (e: { data: unknown }) => {
          const p =
            typeof e.data === 'number' ? e.data : instance!.getCurrentPageIndex();
          setPage(p);
          eagerAround(p);
          // Si la página la pasó el usuario (arrastre / botón / teclado), mueve
          // el scroll para que no "regrese" al soltar.
          if (!fromScroll.active && pinnable()) scrollToPage(p);
          fromScroll.active = false;
        };
        instance.on('flip', onFlip);

        onScroll = () => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            const track = trackRef.current;
            if (!track || !pinnable()) return;
            const rect = track.getBoundingClientRect();
            const vh = window.innerHeight;
            pinned = rect.top <= 0 && rect.bottom >= vh;
            if (!pinned) return;
            const progress = Math.min(
              1,
              Math.max(0, -rect.top / (rect.height - vh)),
            );
            const target = Math.round(progress * (count - 1));
            if (
              target !== lastTarget &&
              target !== instance!.getCurrentPageIndex()
            ) {
              lastTarget = target;
              fromScroll.active = true;
              try {
                instance!.flip(target);
              } catch {
                fromScroll.active = false;
              }
            }
          });
        };
        window.addEventListener('scroll', onScroll, { passive: true });

        onKey = (ev: KeyboardEvent) => {
          if (!pinned || !pinnable()) return;
          if (document.querySelector('.g-lightbox.is-open')) return;
          if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(ev.key)) {
            ev.preventDefault();
            instance!.flipNext();
          } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(ev.key)) {
            ev.preventDefault();
            instance!.flipPrev();
          }
        };
        window.addEventListener('keydown', onKey);
        cleanupRaf = () => {
          if (raf) cancelAnimationFrame(raf);
        };
      } catch {
        if (!cancelled) setMode('grid');
      }
    };

    let onScroll: (() => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;
    let onFlip: ((e: { data: unknown }) => void) | null = null;
    let cleanupRaf: (() => void) | null = null;
    void start();

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (onScroll) window.removeEventListener('scroll', onScroll);
      if (onKey) window.removeEventListener('keydown', onKey);
      cleanupRaf?.();
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

  // ── Fotolibro con pase de página (page-flip) ──────────────────────────────
  const needsBlank = media.length % 2 === 1; // deja la contraportada sola
  // Nº de "posiciones" (portada + pliegos) → altura de la pista de scroll.
  const positions = 2 + Math.ceil(media.length / 2);
  const shownLeaves = leafCount || 2 + media.length + (needsBlank ? 1 : 0);
  return (
    <div className="g-book g-book--flip">
      <div
        className="g-book__track"
        ref={trackRef}
        style={{ '--book-positions': positions } as React.CSSProperties}
      >
        <div
          className="g-book__stage"
          role="region"
          aria-roledescription="fotolibro"
          aria-label={`Fotolibro: ${album.title}. Página ${Math.min(
            page + 1,
            shownLeaves,
          )} de ${shownLeaves}.`}
        >
          <div className="g-book__flip" ref={hostRef}>
            <div className="g-book__leaf g-book__leaf--cover" data-density="hard">
              <BookCover album={album} bg={coverBg} count={media.length} />
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
            <span className="g-book__progress" aria-live="polite">
              {Math.min(page + 1, shownLeaves)} / {shownLeaves}
            </span>
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
