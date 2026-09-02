import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { encode as encodeBlurhash } from 'blurhash';
import sharp from 'sharp';

/** Formatos que `sharp` puede reportar y que aceptamos como entrada. */
const ALLOWED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

/** Derivados responsivos que se generan por imagen (todos en WebP). */
const VARIANT_WIDTHS: { label: string; width: number }[] = [
  { label: 'thumb', width: 240 },
  { label: 'small', width: 640 },
  { label: 'medium', width: 1280 },
  { label: 'large', width: 2048 },
];

/** Tope de píxeles de entrada — corta las "decompression bombs". */
const MAX_INPUT_PIXELS = Number(process.env.UPLOAD_MAX_IMAGE_PIXELS ?? 50_000_000);

/** El original normalizado. */
export interface ProcessedOriginal {
  buffer: Buffer;
  format: string;
  extension: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  checksumSha256: string;
}

/** Un derivado responsivo. */
export interface ProcessedVariant {
  label: string;
  format: 'webp';
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}

/** Todo lo que el pipeline produce a partir de un archivo subido. */
export interface ProcessedImage {
  original: ProcessedOriginal;
  variants: ProcessedVariant[];
  /** BlurHash — placeholder compacto para pintar antes de que cargue la imagen. */
  placeholder: string;
}

/**
 * Pipeline de imagen: valida por contenido, re-codifica (matando cualquier
 * payload embebido y los metadatos EXIF/GPS), y genera los derivados
 * responsivos + el placeholder.
 *
 * `sharp` (libvips) es la única autoridad sobre "¿esto es una imagen y de qué
 * tipo?" — no se confía en la extensión ni en el `Content-Type` del cliente,
 * y no hace falta una librería aparte de sniffing porque `sharp` ya decodifica
 * el contenido real.
 */
@Injectable()
export class ImagePipelineService {
  private readonly logger = new Logger(ImagePipelineService.name);

  /**
   * Procesa un archivo subido.
   *
   * @param input - El buffer crudo tal cual llegó del cliente.
   * @returns El original normalizado, sus derivados y el placeholder.
   * @throws BadRequestException si el contenido no es una imagen decodificable
   *         o su formato no está en la lista blanca (incluye SVG, que se
   *         rechaza siempre por ser XML ejecutable).
   */
  async process(input: Buffer): Promise<ProcessedImage> {
    let format: string | undefined;
    try {
      const probe = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
      format = (await probe.metadata()).format;
    } catch (error) {
      this.logger.warn(`sharp no pudo leer la entrada: ${(error as Error).message}`);
      throw new BadRequestException('El archivo no es una imagen válida.');
    }

    if (!format || !ALLOWED_INPUT_FORMATS.has(format)) {
      throw new BadRequestException(
        `Formato no permitido${format ? ` (${format})` : ''}. Se aceptan JPEG, PNG, WebP y AVIF.`,
      );
    }

    // Re-codificación del original: `.rotate()` sin argumentos aplica la
    // orientación EXIF y luego la descarta; sharp no conserva metadatos salvo
    // que se pida `.withMetadata()` explícito — así se van GPS y EXIF.
    const normalized = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const outputExtension = format === 'png' ? 'png' : 'jpeg';
    const originalBuffer =
      outputExtension === 'png'
        ? await normalized.png({ compressionLevel: 9 }).toBuffer()
        : await normalized.jpeg({ quality: 88, mozjpeg: true }).toBuffer();

    const originalMeta = await sharp(originalBuffer).metadata();
    const original: ProcessedOriginal = {
      buffer: originalBuffer,
      format: outputExtension,
      extension: outputExtension,
      contentType: outputExtension === 'png' ? 'image/png' : 'image/jpeg',
      width: originalMeta.width ?? 0,
      height: originalMeta.height ?? 0,
      bytes: originalBuffer.byteLength,
      checksumSha256: createHash('sha256').update(originalBuffer).digest('hex'),
    };

    const variants: ProcessedVariant[] = [];
    for (const spec of VARIANT_WIDTHS) {
      const buffer = await sharp(originalBuffer)
        .resize({ width: spec.width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const meta = await sharp(buffer).metadata();
      variants.push({
        label: spec.label,
        format: 'webp',
        buffer,
        width: meta.width ?? spec.width,
        height: meta.height ?? 0,
        bytes: buffer.byteLength,
      });
    }

    return {
      original,
      variants,
      placeholder: await this.buildBlurhash(originalBuffer),
    };
  }

  /**
   * Genera el BlurHash de una imagen.
   *
   * @param buffer - El original ya normalizado.
   * @returns La cadena BlurHash (o `''` si falla — es solo un adorno, nunca
   *          debe tumbar la subida).
   */
  private async buildBlurhash(buffer: Buffer): Promise<string> {
    try {
      const { data, info } = await sharp(buffer)
        .raw()
        .ensureAlpha()
        .resize(32, 32, { fit: 'inside' })
        .toBuffer({ resolveWithObject: true });
      return encodeBlurhash(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        4,
        4,
      );
    } catch (error) {
      this.logger.warn(`No se pudo generar el blurhash: ${(error as Error).message}`);
      return '';
    }
  }
}
