'use client';

import { useEffect, useRef, useState } from 'react';
import type { SiteHero } from '@/lib/api';

/**
 * El medio del hero de la portada. Foto → `<img>`. Video → `<video>` en bucle,
 * sin sonido, autoplay — **salvo** que el visitante haya pedido menos
 * movimiento (`prefers-reduced-motion`), en cuyo caso se queda en el póster
 * estático (mismo elemento `<video>` en pausa, para no romper la hidratación).
 *
 * @param props.hero - El hero ya resuelto por `GET /site` (con sus URLs).
 * @param props.className - Clase del elemento (la comparten `<img>` y `<video>`).
 */
export function HeroMedia({
  hero,
  className,
}: {
  hero: SiteHero;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (reduced) el.pause();
    else void el.play().catch(() => undefined);
  }, [reduced]);

  const poster =
    hero.urls.large ?? hero.urls.medium ?? hero.urls.small ?? undefined;

  if (hero.kind !== 'video') {
    const src = hero.urls.large ?? hero.urls.medium ?? hero.urls.original ?? poster;
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={className} fetchPriority="high" />
    ) : null;
  }

  const src = hero.urls.preview;
  if (!src) {
    return poster ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={poster} alt="" className={className} fetchPriority="high" />
    ) : null;
  }

  return (
    <video
      ref={videoRef}
      className={className}
      src={src}
      poster={poster}
      autoPlay={!reduced}
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}
