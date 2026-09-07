/**
 * Carga `hls.js` desde el CDN permitido por la CSP, una sola vez, y devuelve
 * el constructor `Hls`. Se usa para reproducir el HLS adaptativo del video
 * (Fase 14c) en navegadores que no lo soportan de forma nativa (todos menos
 * Safari). Si el script no carga, la promesa se rechaza y el lightbox cae al
 * `preview` MP4.
 */
const HLS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(el: HTMLMediaElement): void;
  destroy(): void;
  on(event: string, cb: (e: unknown, data: { fatal?: boolean }) => void): void;
}

interface HlsCtor {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
}

let promise: Promise<HlsCtor> | null = null;

export function loadHls(): Promise<HlsCtor> {
  const w = window as unknown as { Hls?: HlsCtor };
  if (w.Hls) return Promise.resolve(w.Hls);
  if (promise) return promise;

  promise = new Promise<HlsCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_SRC;
    script.async = true;
    script.onload = () => {
      if (w.Hls) resolve(w.Hls);
      else reject(new Error('hls.js cargó pero no expuso `Hls`'));
    };
    script.onerror = () => reject(new Error('no se pudo cargar hls.js'));
    document.head.appendChild(script);
  });
  return promise;
}
