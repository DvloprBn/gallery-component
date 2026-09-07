import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { escapeHtml } from '../common/utils/escape-html.util';

/** Lado del cuadro de repetición, en la imagen `large` (2048 px) — se acota al tamaño real en cada derivado. */
const MAX_TILE = 320;

/**
 * Configuración de marca de agua ya resuelta (defaults de `site_settings`
 * aplicados) — lista para estampar.
 */
export interface WatermarkConfig {
  /** PNG del logo subido, ya decodificado; `null` si se usa el texto. */
  assetBuffer: Buffer | null;
  /** Texto de respaldo (ya resuelto: nunca vacío si `assetBuffer` es `null`). */
  text: string;
  /** 0.05–0.9 — se acota igual aquí aunque el DTO ya lo valide (defensa en profundidad). */
  opacity: number;
  placement: 'tiled' | 'corner';
}

/**
 * Estampa la marca de agua del sitio sobre un derivado WebP (nunca sobre el
 * original — D9: el archivo de alta resolución no se sirve en público). El
 * logo o el texto se rasteriza vía SVG con `sharp`/librsvg (ya presente en la
 * imagen del backend para el seed de demo) y se compone sobre la imagen.
 *
 * El mosaico se **ajusta al tamaño de cada derivado**: `sharp` exige que lo
 * que se compone quepa dentro de la imagen base, así que el `thumb` (240 px)
 * usa un mosaico más chico que el `large` (2048 px) — nunca uno fijo.
 */
@Injectable()
export class WatermarkService {
  private readonly logger = new Logger(WatermarkService.name);

  /**
   * Aplica la marca de agua a un derivado.
   *
   * @param imageBuffer - El derivado WebP ya generado por el pipeline.
   * @param config - Configuración resuelta (logo o texto, opacidad, patrón).
   * @returns El derivado marcado, en WebP. Si algo falla al construir la
   *          marca, devuelve el buffer **sin marcar** — nunca se sirve un
   *          error 500 por un problema cosmético, pero el llamador decide si
   *          eso es aceptable (para `public` siempre debería lograrse; se
   *          registra un `warn` para poder notarlo).
   */
  async composite(imageBuffer: Buffer, config: WatermarkConfig): Promise<Buffer> {
    const opacity = Math.min(0.9, Math.max(0.05, config.opacity || 0.35));
    try {
      const base = sharp(imageBuffer);
      const baseMeta = await base.metadata();
      // El mosaico nunca puede ser más grande que el lado más chico de la
      // imagen base — sharp exige que lo compuesto quepa dentro de ella.
      const tile = Math.max(
        1,
        Math.min(MAX_TILE, baseMeta.width ?? MAX_TILE, baseMeta.height ?? MAX_TILE),
      );

      const overlay = config.assetBuffer
        ? await this.buildLogoOverlay(config.assetBuffer, opacity, config.placement, tile)
        : await this.buildTextOverlay(config.text, opacity, config.placement, tile);

      const composed =
        config.placement === 'corner'
          ? base.composite([{ input: overlay, gravity: 'southeast' }])
          : base.composite([{ input: overlay, tile: true }]);

      return await composed.webp({ quality: 82 }).toBuffer();
    } catch (error) {
      this.logger.warn(`No se pudo estampar la marca de agua: ${(error as Error).message}`);
      return imageBuffer;
    }
  }

  /**
   * Construye un PNG **transparente del tamaño exacto de un fotograma de
   * video** con la marca ya estampada (mosaico o esquina). ffmpeg lo aplica
   * una sola vez con `overlay=0:0` sobre cada rendition pública (Fase 14c) —
   * la marca no se puede "editar" cuadro a cuadro, va incrustada en la imagen.
   *
   * @param width - Ancho del fotograma de la rendition.
   * @param height - Alto del fotograma de la rendition.
   * @param config - Configuración resuelta (logo o texto, opacidad, patrón).
   * @returns El PNG RGBA `width`×`height`. Si algo falla al construir la marca,
   *          devuelve un PNG **transparente sin marca** — el llamador decide si
   *          eso es aceptable (para `public` debería lograrse; se registra un
   *          `warn`).
   */
  async buildFrameOverlay(
    width: number,
    height: number,
    config: WatermarkConfig,
  ): Promise<Buffer> {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const transparent = sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
    try {
      const opacity = Math.min(0.9, Math.max(0.05, config.opacity || 0.35));
      const tile = Math.max(1, Math.min(MAX_TILE, w, h));
      const overlay = config.assetBuffer
        ? await this.buildLogoOverlay(config.assetBuffer, opacity, config.placement, tile)
        : await this.buildTextOverlay(config.text, opacity, config.placement, tile);
      const composed =
        config.placement === 'corner'
          ? transparent.composite([{ input: overlay, gravity: 'southeast' }])
          : transparent.composite([{ input: overlay, tile: true }]);
      return await composed.png().toBuffer();
    } catch (error) {
      this.logger.warn(
        `No se pudo construir la marca de agua para video: ${(error as Error).message}`,
      );
      return await transparent.png().toBuffer();
    }
  }

  /** Construye el mosaico de texto (rotado en `tiled`, recto en `corner`), como PNG con alfa. */
  private async buildTextOverlay(
    text: string,
    opacity: number,
    placement: 'tiled' | 'corner',
    tile: number,
  ): Promise<Buffer> {
    const rotate = placement === 'tiled' ? -18 : 0;
    const fontSize = Math.round(tile * 0.11);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">
        <g transform="translate(${tile / 2} ${tile / 2}) rotate(${rotate})">
          <text x="0" y="0" text-anchor="middle" dominant-baseline="middle"
                font-family="'DejaVu Sans', sans-serif" font-size="${fontSize}" font-weight="600"
                fill="#ffffff" fill-opacity="${opacity}"
                stroke="#000000" stroke-opacity="${opacity * 0.55}" stroke-width="1.5"
                paint-order="stroke">${escapeHtml(text.slice(0, 60))}</text>
        </g>
      </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /** Construye el mosaico del logo subido (rotado en `tiled`, recto en `corner`), como PNG con alfa. */
  private async buildLogoOverlay(
    logo: Buffer,
    opacity: number,
    placement: 'tiled' | 'corner',
    tile: number,
  ): Promise<Buffer> {
    const rotate = placement === 'tiled' ? -18 : 0;
    const meta = await sharp(logo).metadata();
    const naturalW = meta.width ?? 200;
    const naturalH = meta.height ?? 200;
    const maxSide = tile * 0.55;
    const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    const base64 = logo.toString('base64');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">
        <g transform="translate(${tile / 2} ${tile / 2}) rotate(${rotate})">
          <image href="data:image/png;base64,${base64}"
                 x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}"
                 opacity="${opacity}" />
        </g>
      </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
}
