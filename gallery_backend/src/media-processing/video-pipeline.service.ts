import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Contenedores de entrada admitidos (lo que `ffprobe` reporta en `format_name`). */
const ALLOWED_CONTAINERS = [
  'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', // familia QuickTime/ISO-BMFF
  'matroska', 'webm',
];

/** Duración máxima de un video subido, en segundos (es un portafolio, no una CDN de video). */
const MAX_DURATION_S = Math.max(1, Number(process.env.VIDEO_MAX_DURATION_S) || 120);

/** Tamaño máximo del archivo de entrada, en bytes (default 200 MiB). */
const MAX_INPUT_BYTES = Math.max(
  1_000_000,
  Number(process.env.VIDEO_MAX_INPUT_BYTES) || 209_715_200,
);

/** Píxeles máximos por fotograma (default 1920×1080). */
const MAX_PIXELS = Math.max(
  1,
  Number(process.env.VIDEO_MAX_PIXELS) || 1920 * 1080,
);

/** Frame rate máximo plausible — por encima es una bomba de descompresión de video. */
const MAX_FRAME_RATE = Math.max(1, Number(process.env.VIDEO_MAX_FRAME_RATE) || 121);

/** Tiempo tope de un transcode antes de matar el proceso (default 10 min). */
const TRANSCODE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.VIDEO_TRANSCODE_TIMEOUT_MS) || 600_000,
);

/**
 * Flags comunes a `ffmpeg` **y** `ffprobe`:
 * - `-hide_banner` : menos ruido en los logs.
 * - `-protocol_whitelist file,crypto` : NO se abre `http(s)`/`tcp` — corta
 *   cualquier SSRF vía playlists o URLs incrustadas en el contenedor.
 */
const FFPROBE_BASE = ['-hide_banner', '-protocol_whitelist', 'file,crypto'];

/** `ffmpeg` además acepta `-nostdin` (no leer de stdin — que no se cuelgue esperando). */
const FFMPEG_BASE = ['-nostdin', ...FFPROBE_BASE];

/** Metadatos técnicos de un video, tras validarlo. */
export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  /** Fotogramas por segundo (ya resuelto de la fracción `r_frame_rate`). */
  frameRate: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
}

/**
 * Pipeline de video (Fase 14): valida por contenido con `ffprobe`, y produce
 * con `ffmpeg` un *master* limpio, un fotograma de portada y un *preview*
 * progresivo. Igual que `RightsMetadataService` con `exiftool`, todo se invoca
 * con `execFile` + un **array de argumentos** — nunca una shell, nunca
 * interpolando datos del usuario — y sin acceso de red (`-protocol_whitelist`).
 *
 * Trabaja siempre sobre **rutas de archivo temporales**, no sobre buffers en
 * memoria: un video puede pesar cientos de MB y no tiene sentido tenerlo entero
 * en RAM.
 */
@Injectable()
export class VideoPipelineService {
  private readonly logger = new Logger(VideoPipelineService.name);

  /**
   * Valida un archivo de video por su contenido real y devuelve sus metadatos.
   *
   * @param inputPath - Ruta al archivo temporal recién subido.
   * @param sizeBytes - Tamaño del archivo (para el límite de entrada).
   * @returns Los metadatos técnicos si pasa todas las comprobaciones.
   * @throws BadRequestException si `ffprobe` no lo puede leer, si el contenedor
   *         no está permitido, si no hay stream de video, si dura o mide más de
   *         lo permitido, si trae más de un stream de video/audio, o si el
   *         frame rate es imposible.
   */
  async probe(inputPath: string, sizeBytes: number): Promise<VideoProbe> {
    if (sizeBytes > MAX_INPUT_BYTES) {
      throw new BadRequestException(
        `El video supera el tamaño máximo (${Math.round(MAX_INPUT_BYTES / 1_048_576)} MB).`,
      );
    }

    let parsed: FfprobeJson;
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          ...FFPROBE_BASE,
          '-v', 'error',
          '-show_format',
          '-show_streams',
          '-of', 'json',
          inputPath,
        ],
        { timeout: 20_000, maxBuffer: 4_000_000 },
      );
      parsed = JSON.parse(stdout) as FfprobeJson;
    } catch (error) {
      this.logger.warn(`ffprobe no pudo leer la entrada: ${(error as Error).message}`);
      throw new BadRequestException('El archivo no es un video válido.');
    }

    const containerOk = (parsed.format?.format_name ?? '')
      .split(',')
      .some((name) => ALLOWED_CONTAINERS.includes(name.trim()));
    if (!containerOk) {
      throw new BadRequestException(
        'Contenedor de video no permitido. Se aceptan MP4/MOV y WebM/MKV.',
      );
    }

    const videoStreams = (parsed.streams ?? []).filter((s) => s.codec_type === 'video');
    const audioStreams = (parsed.streams ?? []).filter((s) => s.codec_type === 'audio');
    if (videoStreams.length === 0) {
      throw new BadRequestException('El archivo no contiene un stream de video.');
    }
    if (videoStreams.length > 1 || audioStreams.length > 1) {
      throw new BadRequestException('El video tiene más de una pista de imagen o de sonido.');
    }

    const v = videoStreams[0];
    const width = Number(v.width) || 0;
    const height = Number(v.height) || 0;
    if (width < 1 || height < 1) {
      throw new BadRequestException('No se pudieron determinar las dimensiones del video.');
    }
    if (width * height > MAX_PIXELS) {
      throw new BadRequestException(
        `La resolución del video supera el máximo permitido (${MAX_PIXELS.toLocaleString()} px).`,
      );
    }

    const durationSec = Number(parsed.format?.duration) || 0;
    if (durationSec <= 0) {
      throw new BadRequestException('No se pudo determinar la duración del video.');
    }
    if (durationSec > MAX_DURATION_S) {
      throw new BadRequestException(
        `El video dura más del máximo permitido (${MAX_DURATION_S} s).`,
      );
    }

    const frameRate = parseFraction(v.r_frame_rate);
    if (frameRate <= 0 || frameRate > MAX_FRAME_RATE) {
      throw new BadRequestException('El video declara un frame rate imposible.');
    }

    const audio = audioStreams[0];
    return {
      durationMs: Math.round(durationSec * 1000),
      width,
      height,
      frameRate: Math.round(frameRate * 1000) / 1000,
      videoCodec: (v.codec_name ?? 'unknown').slice(0, 16),
      audioCodec: audio ? (audio.codec_name ?? 'unknown').slice(0, 16) : null,
      hasAudio: audioStreams.length > 0,
    };
  }

  /**
   * Re-codifica el archivo subido a un *master* MP4 normalizado y **sin ningún
   * metadato** (`-map_metadata -1` — el equivalente a que `sharp` tire el EXIF).
   * Este master es la copia limpia de alta calidad: nunca se sirve en público,
   * solo se entrega bajo licencia (Fase 14d).
   *
   * @param inputPath - El archivo temporal subido.
   * @param outPath - Dónde escribir el master `.mp4`.
   * @param hasAudio - Si mapear (y codificar) la pista de audio.
   */
  async transcodeMaster(inputPath: string, outPath: string, hasAudio: boolean): Promise<void> {
    const map = hasAudio
      ? ['-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k']
      : ['-map', '0:v:0', '-an'];
    await this.runFfmpeg([
      '-i', inputPath,
      ...map,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      outPath,
    ]);
  }

  /**
   * Extrae un fotograma como PNG para usarlo de portada del video.
   *
   * @param masterPath - El master ya transcodificado.
   * @param outPngPath - Dónde escribir el PNG.
   * @param atMs - Momento del fotograma, en milisegundos (se acota a la duración).
   */
  async extractPoster(masterPath: string, outPngPath: string, atMs: number): Promise<void> {
    await this.runFfmpeg([
      '-ss', (Math.max(0, atMs) / 1000).toFixed(3),
      '-i', masterPath,
      '-frames:v', '1',
      '-map_metadata', '-1',
      outPngPath,
    ]);
  }

  /**
   * Genera un *preview* progresivo: un único MP4 a 720p como máximo, con
   * `+faststart` (empieza a reproducir sin descargar todo) — es lo que se
   * reproduce en el lightbox mientras no haya HLS (Fase 14c). Va **sin marca de
   * agua** en esta sub-fase; la marca llega en la 14c.
   *
   * @param masterPath - El master ya transcodificado.
   * @param outPath - Dónde escribir el preview `.mp4`.
   * @param hasAudio - Si incluir el audio.
   */
  async buildPreview(masterPath: string, outPath: string, hasAudio: boolean): Promise<void> {
    const map = hasAudio
      ? ['-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k']
      : ['-map', '0:v:0', '-an'];
    await this.runFfmpeg([
      '-i', masterPath,
      ...map,
      // Baja a 720p de alto como máximo; nunca amplía. `-2` mantiene la
      // proporción y fuerza dimensión par (lo exige yuv420p).
      '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      outPath,
    ]);
  }

  /**
   * Genera una *rendition* HLS: el master escalado a un tamaño exacto, con la
   * marca de agua incrustada (si se pasa `overlayPngPath`), codificada con los
   * fotogramas clave alineados a 2 s para que los segmentos HLS partan limpio.
   *
   * @param masterPath - El master ya transcodificado.
   * @param outPath - Dónde escribir el MP4 de la rendition.
   * @param size - `{ width, height }` EXACTOS de la rendition (par, sin ampliar).
   * @param fps - Fotogramas por segundo del master (para el tamaño del GOP).
   * @param bitrateKbps - Bitrate objetivo del video.
   * @param overlayPngPath - PNG RGBA del tamaño de la rendition con la marca, o
   *   `null` para no estampar (álbumes no `public`).
   * @param hasAudio - Si mapear/codificar el audio.
   */
  async buildRendition(
    masterPath: string,
    outPath: string,
    size: { width: number; height: number },
    fps: number,
    bitrateKbps: number,
    overlayPngPath: string | null,
    hasAudio: boolean,
  ): Promise<void> {
    const gop = Math.max(2, Math.round(fps * 2));
    const scale = `scale=${size.width}:${size.height}:flags=lanczos`;
    const inputs = ['-i', masterPath];
    let filter: string;
    if (overlayPngPath) {
      inputs.push('-i', overlayPngPath);
      filter = `[0:v]${scale}[v];[v][1:v]overlay=0:0:format=auto[vo]`;
    } else {
      filter = `[0:v]${scale}[vo]`;
    }
    const audio = hasAudio
      ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k']
      : ['-an'];
    await this.runFfmpeg([
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vo]',
      ...audio,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', `${bitrateKbps}k`,
      '-maxrate', `${Math.round(bitrateKbps * 1.2)}k`,
      '-bufsize', `${bitrateKbps * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-g', String(gop),
      '-keyint_min', String(gop),
      '-sc_threshold', '0',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      outPath,
    ]);
  }

  /**
   * Empaqueta varias renditions ya codificadas en un HLS VOD multi-calidad:
   * un `master.m3u8` + un `stream_N.m3u8` + segmentos `seg_N_*.ts` por
   * rendition. Solo remultiplexa (`-c copy`), es rápido.
   *
   * @param renditionPaths - Rutas de los MP4 de rendition, de menor a mayor.
   * @param outDir - Directorio donde escribir playlists y segmentos.
   * @param hasAudio - Si las renditions traen pista de audio.
   */
  async packageHls(
    renditionPaths: string[],
    outDir: string,
    hasAudio: boolean,
  ): Promise<void> {
    const inputs: string[] = [];
    renditionPaths.forEach((p) => inputs.push('-i', p));
    const maps: string[] = [];
    renditionPaths.forEach((_, i) => {
      maps.push('-map', `${i}:v:0`);
      if (hasAudio) maps.push('-map', `${i}:a:0`);
    });
    const varMap = renditionPaths
      .map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`))
      .join(' ');
    await this.runFfmpeg([
      ...inputs,
      ...maps,
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', varMap,
      '-hls_segment_filename', join(outDir, 'seg_%v_%03d.ts'),
      join(outDir, 'stream_%v.m3u8'),
    ]);
  }

  /** Corre `ffmpeg` con los flags base + `-y` (sobrescribe) y el timeout de transcode. */
  private async runFfmpeg(args: string[]): Promise<void> {
    try {
      await execFileAsync('ffmpeg', [...FFMPEG_BASE, '-y', ...args], {
        timeout: TRANSCODE_TIMEOUT_MS,
        maxBuffer: 4_000_000,
      });
    } catch (error) {
      // No se expone al usuario — lo captura el job y lo guarda en `processing_error`.
      throw new Error(`ffmpeg falló: ${(error as Error).message}`);
    }
  }
}

/** Convierte una fracción tipo `"30000/1001"` a número; `0` si no se puede. */
function parseFraction(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num)) return 0;
  if (den === undefined) return num;
  if (!Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

/** Forma mínima del JSON de `ffprobe` que nos interesa. */
interface FfprobeJson {
  format?: { format_name?: string; duration?: string; size?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }[];
}
