'use client';

import { decode } from 'blurhash';
import { useEffect, useRef } from 'react';

/** Resolución a la que se decodifica el BlurHash (basta muy poca). */
const SIZE = 32;

/**
 * Pinta un BlurHash en un `<canvas>` que actúa de placeholder detrás de la
 * imagen real, hasta que ésta carga. Si el hash es inválido o vacío, no
 * pinta nada (queda el color de fondo).
 */
export function BlurhashCanvas({ hash }: { hash: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!hash) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const pixels = decode(hash, SIZE, SIZE);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(SIZE, SIZE);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // hash inválido — se ignora, queda el fondo.
    }
  }, [hash]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      aria-hidden="true"
      className="g-blur"
    />
  );
}
