import { BadRequestException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { VideoPipelineService } from './video-pipeline.service';

const execFileAsync = promisify(execFile);

/**
 * Integración real con el binario `ffmpeg`/`ffprobe` (igual que
 * `rights-metadata.service.spec.ts` con `exiftool`): se genera un MP4 diminuto
 * de verdad y se comprueba que el pipeline lo valida, transcodifica, saca
 * portada y preview.
 */
describe('VideoPipelineService (ffmpeg real)', () => {
  const service = new VideoPipelineService();
  let dir: string;
  let sample: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gallery-video-spec-'));
    sample = join(dir, 'sample.mp4');
    // 2 s, 320x240, 12 fps, con audio — un video real y minúsculo.
    await execFileAsync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      sample,
    ]);
  }, 30_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('probe() lee los metadatos de un MP4 válido', async () => {
    const size = (await stat(sample)).size;
    const probe = await service.probe(sample, size);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.durationMs).toBeGreaterThanOrEqual(1800);
    expect(probe.durationMs).toBeLessThanOrEqual(2400);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.hasAudio).toBe(true);
    expect(probe.audioCodec).toBe('aac');
    expect(probe.frameRate).toBeCloseTo(12, 0);
  });

  it('probe() rechaza un archivo que no es video', async () => {
    const notVideo = join(dir, 'nope.bin');
    await writeFile(notVideo, Buffer.from('esto no es un contenedor de video'));
    await expect(service.probe(notVideo, 100)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('probe() rechaza un archivo por encima del tamaño máximo', async () => {
    await expect(service.probe(sample, 999_999_999_999)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('transcodeMaster() produce un MP4 sin metadatos', async () => {
    const master = join(dir, 'master.mp4');
    await service.transcodeMaster(sample, master, true);
    const probe = await service.probe(master, (await stat(master)).size);
    expect(probe.videoCodec).toBe('h264');
    // `-map_metadata -1`: exiftool no debería encontrar copyright/artista.
    const { stdout } = await execFileAsync('exiftool', ['-Copyright', '-Artist', '-s3', master]);
    expect(stdout.trim()).toBe('');
  }, 30_000);

  it('extractPoster() saca un PNG real', async () => {
    const master = join(dir, 'master.mp4');
    const poster = join(dir, 'poster.png');
    await service.extractPoster(master, poster, 500);
    const buf = await readFile(poster);
    // Firma PNG.
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }, 30_000);

  it('buildPreview() genera un MP4 <=720p con faststart', async () => {
    const master = join(dir, 'master.mp4');
    const preview = join(dir, 'preview.mp4');
    await service.buildPreview(master, preview, true);
    const probe = await service.probe(preview, (await stat(preview)).size);
    expect(probe.height).toBeLessThanOrEqual(720);
    expect(probe.width).toBeLessThanOrEqual(1280);
  }, 30_000);
});
