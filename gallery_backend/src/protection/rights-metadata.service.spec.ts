import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { RightsMetadataService } from './rights-metadata.service';

const execFileAsync = promisify(execFile);

/** Lee de vuelta las etiquetas de un buffer con el `exiftool` real (verificación, no producción). */
async function readTags(buffer: Buffer, ext: string): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), 'gallery-meta-test-'));
  const file = join(dir, `f.${ext}`);
  try {
    await writeFile(file, buffer);
    const { stdout } = await execFileAsync('exiftool', ['-j', '-G1', file]);
    return (JSON.parse(stdout) as Record<string, unknown>[])[0];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function sampleJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();
}

const rights = {
  rightsHolder: 'Mara Solís',
  creator: 'Mara Solís',
  creditLine: 'Estudio Mara Solís',
  rightsStatement: '© Mara Solís 2026. Todos los derechos reservados.',
  licenseTerms: 'Uso editorial únicamente, con crédito.',
  licensorUrl: 'https://marasolis.mx',
};

describe('RightsMetadataService (integración, exiftool real)', () => {
  const service = new RightsMetadataService();

  it('incrusta los derechos como IPTC/XMP legibles con exiftool', async () => {
    const image = await sampleJpeg();
    const withRights = await service.embed(image, 'jpeg', rights);

    expect(withRights.equals(image)).toBe(false);

    const tags = await readTags(withRights, 'jpeg');
    expect(String(tags['XMP-dc:Rights'])).toContain('Mara Solís');
    expect(String(tags['XMP-dc:Creator'])).toBe('Mara Solís');
    expect(String(tags['XMP-xmpRights:UsageTerms'])).toContain('editorial');
    expect(String(tags['IPTC:CopyrightNotice'])).toContain('Mara Solís');
  }, 20_000);

  it('no incrusta IPTC en un WebP (el contenedor no lo soporta), pero sí XMP', async () => {
    const webp = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } })
      .webp()
      .toBuffer();
    const withRights = await service.embed(webp, 'webp', rights);

    const tags = await readTags(withRights, 'webp');
    expect(String(tags['XMP-dc:Rights'])).toContain('Mara Solís');
    expect(tags['IPTC:CopyrightNotice']).toBeUndefined();
  }, 20_000);

  it('sanea saltos de línea y caracteres de control antes de pasarlos a exiftool', async () => {
    const image = await sampleJpeg();
    const withRights = await service.embed(image, 'jpeg', {
      ...rights,
      rightsStatement: 'Línea 1\nLínea 2\r\n-fake-flag',
    });

    const tags = await readTags(withRights, 'jpeg');
    // Se convierte en una sola línea; nunca rompe el proceso ni se interpreta
    // como una bandera aparte de exiftool.
    expect(String(tags['XMP-dc:Rights'])).not.toContain('\n');
  }, 20_000);

  it('si no hay ningún campo de derechos, no toca el buffer (no lanza exiftool)', async () => {
    const image = await sampleJpeg();
    const empty = {
      rightsHolder: '',
      creator: '',
      creditLine: '',
      rightsStatement: '',
      licenseTerms: '',
      licensorUrl: '',
    };
    const result = await service.embed(image, 'jpeg', empty);
    expect(result).toBe(image); // misma referencia — ni siquiera se copió
  });
});
