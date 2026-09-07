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
  // `true` cuando el próximo giro lo pidió el usuario (arrastre / botón /
  // teclado) y no el scroll — el efecto lo usa para alinear el scroll a la
  // página nueva sin entrar en el lazo scroll↔giro. Lo lee y lo baja el `flip`.
  const userFlipRef = useRef(false);

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
          maxShadowOpacity: 0.65,
          drawShadow: true,
          flippingTime: 750,
          showCover: true,
          showPageCorners: true, // esquina que se despega al pasar el ratón
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

        // ── Scroll fijo ↔ pase de página ─────────────────────────────────
        //  El bug de "avanza y se cicla" era un lazo: al pasar página el
        //  handler movía el scroll con `behavior:'smooth'`, ese scroll suave
        //  disparaba decenas de eventos `scroll`, y esos re-disparaban `flip()`
        //  antes de que el anterior terminara. La cura, sin cambiar de
        //  librería:
        //   (1) mientras la sección está fija, el scroll es la ÚNICA fuente
        //       de verdad — la página es función del progreso de scroll;
        //   (2) los giros del usuario (arrastre/botón/teclado) alinean el
        //       scroll a la página nueva de forma INSTANTÁNEA (`behavior:'auto'`)
        //       y con una ventana de silencio, para que ese `scrollTo` no
        //       vuelva a disparar un giro;
        //   (3) nunca se llama `flip()` mientras `page-flip` está animando
        //       (`changeState` = `flipping`/`user_fold`);
        //   (4) al parar el scroll, se "asienta" exactamente sobre una página
        //       (nunca a medio camino, que es lo que hacía oscilar el
        //       `Math.round`).
        const pinnable = () =>
          window.matchMedia('(min-width: 701px)').matches &&
          window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

        let raf = 0;
        let pinned = false;
        let busy = false; // page-flip animando (o el usuario arrastrando)
        let lastTarget = instance.getCurrentPageIndex();
        let suppressUntil = 0; // ignora scroll→giro hasta este instante
        let snapTimer = 0;

        const eagerAround = (idx: number) => {
          const imgs = host.querySelectorAll<HTMLImageElement>('.g-book__leaf img');
          for (const n of [idx, idx + 1, idx + 2]) {
            const img = imgs[n - 1];
            if (img && img.loading === 'lazy') img.loading = 'eager';
          }
        };

        /** Posición de scroll que corresponde a ver la página `p`. */
        const offsetForPage = (p: number) => {
          const track = trackRef.current;
          if (!track) return 0;
          const span = track.offsetHeight - window.innerHeight;
          const frac = count > 1 ? p / (count - 1) : 0;
          return track.offsetTop + Math.max(0, Math.min(span, frac * span));
        };

        /** Alinea el scroll a `p` sin animación y silencia el sync un momento. */
        const syncScrollTo = (p: number) => {
          if (!pinnable()) return;
          suppressUntil = performance.now() + 400;
          window.scrollTo({ top: offsetForPage(p), behavior: 'auto' });
        };

        /** Al quedarse quieto el scroll, asienta sobre la página exacta. */
        const scheduleSnap = () => {
          window.clearTimeout(snapTimer);
          snapTimer = window.setTimeout(() => {
            if (!pinnable() || busy || performance.now() < suppressUntil) return;
            const p = instance!.getCurrentPageIndex();
            const want = offsetForPage(p);
            if (Math.abs(window.scrollY - want) > 4) {
              suppressUntil = performance.now() + 400;
              window.scrollTo({ top: want, behavior: 'auto' });
            }
          }, 160);
        };

        onChangeState = (e: { data: unknown }) => {
          const s = e.data;
          busy = s === 'flipping' || s === 'user_fold';
          // Un arrastre real lo empieza el usuario → el `flip` que venga hay
          // que acompañarlo moviendo el scroll.
          if (s === 'user_fold') userFlipRef.current = true;
        };
        instance.on('changeState', onChangeState);

        onFlip = (e: { data: unknown }) => {
          const p =
            typeof e.data === 'number' ? e.data : instance!.getCurrentPageIndex();
          lastTarget = p;
          setPage(p);
          eagerAround(p);
          // Giro del usuario (arrastre/botón/teclado) → alinea el scroll a la
          // página nueva. Giro pedido por el scroll → el scroll ya está ahí.
          if (userFlipRef.current) {
            userFlipRef.current = false;
            syncScrollTo(p);
          }
        };
        instance.on('flip', onFlip);

        onScroll = () => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (!pinnable()) return;
            const track = trackRef.current;
            if (!track) return;
            const rect = track.getBoundingClientRect();
            const vh = window.innerHeight;
            pinned = rect.top <= 0 && rect.bottom >= vh;
            scheduleSnap();
            if (!pinned || busy) return;
            if (performance.now() < suppressUntil) return; // scrollTo nuestro
            const denom = rect.height - vh;
            if (denom <= 0) return;
            const progress = Math.min(1, Math.max(0, -rect.top / denom));
            const target = Math.round(progress * (count - 1));
            if (
              target !== lastTarget &&
              target !== instance!.getCurrentPageIndex()
            ) {
              lastTarget = target;
              userFlipRef.current = false; // lo pide el scroll, no el usuario
              try {
                instance!.flip(target);
              } catch {
                /* noop */
              }
            }
          });
        };
        window.addEventListener('scroll', onScroll, { passive: true });

        // `scrollend` (Chrome/Firefox) levanta el silencio antes del timeout.
        onScrollEnd = () => {
          suppressUntil = 0;
        };
        window.addEventListener('scrollend', onScrollEnd);

        onKey = (ev: KeyboardEvent) => {
          if (!pinned || !pinnable()) return;
          if (document.querySelector('.g-lightbox.is-open')) return;
          if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(ev.key)) {
            ev.preventDefault();
            userFlipRef.current = true;
            instance!.flipNext();
          } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(ev.key)) {
            ev.preventDefault();
            userFlipRef.current = true;
            instance!.flipPrev();
          }
        };
        window.addEventListener('keydown', onKey);
        cleanupRaf = () => {
          if (raf) cancelAnimationFrame(raf);
          window.clearTimeout(snapTimer);
        };
      } catch {
        if (!cancelled) setMode('grid');
      }
    };

    let onScroll: (() => void) | null = null;
    let onScrollEnd: (() => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;
    let onFlip: ((e: { data: unknown }) => void) | null = null;
    let onChangeState: ((e: { data: unknown }) => void) | null = null;
    let cleanupRaf: (() => void) | null = null;
    void start();

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (onScroll) window.removeEventListener('scroll', onScroll);
      if (onScrollEnd) window.removeEventListener('scrollend', onScrollEnd);
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
          {/* Cuerpo del libro: tapas, lomo, canto y sombra alrededor de
              `page-flip` — todo decorativo. `--book-page` / `--book-count`
              mueven el grosor de cada taco de hojas según por dónde vas. */}
          <div
            className="g-book__body"
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
              onClick={() => {
                userFlipRef.current = true;
                flipRef.current?.flipPrev();
              }}
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
              onClick={() => {
                userFlipRef.current = true;
                flipRef.current?.flipNext();
              }}
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
