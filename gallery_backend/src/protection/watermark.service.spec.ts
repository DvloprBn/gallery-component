import sharp from 'sharp';
import { WatermarkService } from './watermark.service';

/** Un JPEG sólido de prueba (200×150), sin depender de ningún archivo externo. */
async function sampleImage(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 150, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer();
}

/** Un PNG pequeño de prueba, como si fuera el logo subido por el fotógrafo. */
async function sampleLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('WatermarkService', () => {
  const service = new WatermarkService();

  it('estampa texto en patrón tiled y devuelve un WebP decodificable del mismo tamaño', async () => {
    const image = await sampleImage();
    const out = await service.composite(image, {
      assetBuffer: null,
      text: '© Mara Solís',
      opacity: 0.4,
      placement: 'tiled',
    });

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
    // El estampado cambia los píxeles — el resultado no es idéntico al original re-codificado tal cual.
    expect(out.equals(image)).toBe(false);
  });

  it('estampa texto en patrón corner (una sola vez, esquina)', async () => {
    const image = await sampleImage();
    const out = await service.composite(image, {
      assetBuffer: null,
      text: 'Prueba',
      opacity: 0.5,
      placement: 'corner',
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
  });

  it('estampa el logo subido en vez del texto cuando hay assetBuffer', async () => {
    const image = await sampleImage();
    const logo = await sampleLogo();
    const out = await service.composite(image, {
      assetBuffer: logo,
      text: 'no debería usarse',
      opacity: 0.6,
      placement: 'tiled',
    });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
  });

  it('acota una opacidad fuera de rango en vez de fallar', async () => {
    const image = await sampleImage();
    await expect(
      service.composite(image, {
        assetBuffer: null,
        text: 'x',
        opacity: 5, // fuera de [0.05, 0.9] — se acota, no truena
        placement: 'tiled',
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('funciona en un derivado más chico que el mosaico máximo (thumb 96×70)', async () => {
    // Regresión: sharp exige que lo compuesto quepa dentro de la base: un
    // mosaico fijo de 320px rompía el `thumb` (240px de ancho o menos).
    const small = await sharp({
      create: { width: 96, height: 70, channels: 3, background: '#204060' },
    })
      .jpeg()
      .toBuffer();

    const out = await service.composite(small, {
      assetBuffer: null,
      text: '© Mara Solís',
      opacity: 0.4,
      placement: 'tiled',
    });

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp'); // si hubiera fallado, seguiría siendo jpeg (sin marcar)
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(70);
  });

  it('nunca tumba la subida: si el buffer de entrada no es una imagen, devuelve algo (no lanza)', async () => {
    await expect(
      service.composite(Buffer.from('no es una imagen'), {
        assetBuffer: null,
        text: 'x',
        opacity: 0.3,
        placement: 'tiled',
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('buildFrameOverlay() devuelve un PNG RGBA del tamaño exacto del fotograma (Fase 14c)', async () => {
    const png = await service.buildFrameOverlay(640, 360, {
      assetBuffer: null,
      text: '© Mara Solís',
      opacity: 0.35,
      placement: 'tiled',
    });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
    expect(meta.channels).toBe(4); // con alfa — se compone sobre el video
    // Hay píxeles no transparentes (la marca): el canal alfa no es todo 0.
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let maxAlpha = 0;
    for (let i = 3; i < data.length; i += 4) maxAlpha = Math.max(maxAlpha, data[i]);
    expect(maxAlpha).toBeGreaterThan(0);
  });
});
