import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { ImagePipelineService } from './image-pipeline.service';

/** JPEG con EXIF embebido (marca, software, copyright), para probar que se elimina. */
async function jpegWithExif(width = 1200, height = 900): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .jpeg()
    .withExif({
      IFD0: {
        Software: 'PruebaGaleria',
        Make: 'CámaraFicticia',
        Copyright: 'dato personal que no debe sobrevivir',
      },
    })
    .toBuffer();
}

describe('ImagePipelineService', () => {
  const pipeline = new ImagePipelineService();

  it('procesa un JPEG válido: original normalizado + 4 derivados WebP + placeholder', async () => {
    const result = await pipeline.process(await jpegWithExif(1600, 1200));

    expect(result.original.format).toBe('jpeg');
    expect(result.original.width).toBe(1600);
    expect(result.original.height).toBe(1200);
    expect(result.original.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const labels = result.variants.map((v) => v.label).sort();
    expect(labels).toEqual(['large', 'medium', 'small', 'thumb']);
    for (const variant of result.variants) {
      expect(variant.format).toBe('webp');
      expect(variant.width).toBeLessThanOrEqual(result.original.width);
      expect((await sharp(variant.buffer).metadata()).format).toBe('webp');
    }

    expect(result.placeholder.length).toBeGreaterThan(10);
  });

  it('elimina los metadatos EXIF/GPS del original servido', async () => {
    const input = await jpegWithExif();
    expect((await sharp(input).metadata()).exif).toBeTruthy();

    const result = await pipeline.process(input);
    expect((await sharp(result.original.buffer).metadata()).exif).toBeFalsy();
  });

  it('rechaza contenido que no es una imagen', async () => {
    await expect(
      pipeline.process(Buffer.from('esto no es una imagen, es texto plano')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un SVG (aunque sharp lo entienda) — es XML ejecutable', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    await expect(pipeline.process(svg)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una imagen con demasiados píxeles (decompression bomb)', async () => {
    // 9000 x 9000 = 81 MP, por encima del tope por defecto (50 MP). Pocos KB.
    const bomb = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: '#111' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(pipeline.process(bomb)).rejects.toBeInstanceOf(BadRequestException);
  });
});
