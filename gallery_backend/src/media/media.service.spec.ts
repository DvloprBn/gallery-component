import type { PrismaService } from '../common/prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { MediaService, SHOWCASE_LIMIT } from './media.service';

/** Fila de `media` (con `variants`) como la devolvería Prisma. */
function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    media_id: 'm-0',
    kind: 'photo' as 'photo' | 'video',
    width: 1600,
    height: 1067,
    duration_ms: null,
    placeholder: 'blur',
    alt_text: null,
    caption: null,
    storage_key: 'orig-0.webp',
    hls_manifest_key: null,
    hls_keys: [],
    status: 'published',
    created_at: new Date(),
    variants: [
      { label: 'small', storage_key: 'small-0.webp' },
      { label: 'large', storage_key: 'large-0.webp' },
    ],
    ...overrides,
  };
}

/** N fotos, marcadas `p0`..`p{n-1}`. */
function photos(n: number) {
  return Array.from({ length: n }, (_, i) =>
    mediaRow({
      media_id: `p${i}`,
      kind: 'photo',
      storage_key: `orig-p${i}.webp`,
      variants: [{ label: 'small', storage_key: `small-p${i}.webp` }],
    }),
  );
}

/** N videos, marcados `v0`..`v{n-1}`, con HLS. */
function videos(n: number) {
  return Array.from({ length: n }, (_, i) =>
    mediaRow({
      media_id: `v${i}`,
      kind: 'video',
      duration_ms: 12_000,
      storage_key: `master-v${i}.mp4`,
      hls_manifest_key: `hls-v${i}/master.m3u8`,
      variants: [
        { label: 'small', storage_key: `poster-v${i}.webp` },
        { label: 'preview', storage_key: `preview-v${i}.mp4` },
      ],
    }),
  );
}

describe('MediaService.listShowcase', () => {
  let prisma: { media: { findMany: jest.Mock } };
  let storage: { urlFor: jest.Mock };
  let service: MediaService;

  beforeEach(() => {
    prisma = { media: { findMany: jest.fn() } };
    storage = { urlFor: jest.fn((key: string) => `https://cdn.test/${key}`) };
    service = new MediaService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  it('consulta solo publicados de álbumes públicos, más nuevos primero', async () => {
    prisma.media.findMany.mockResolvedValue(photos(20));

    await service.listShowcase();

    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'published', album: { visibility: 'public' } },
        orderBy: { created_at: 'desc' },
        include: { variants: true },
      }),
    );
  });

  it('nunca expone el original limpio (D9) — ni para fotos ni para videos', async () => {
    prisma.media.findMany.mockResolvedValue([...videos(3), ...photos(30)]);

    const out = await service.listShowcase();

    for (const item of out) {
      expect(item.urls).not.toHaveProperty('original');
    }
  });

  it('devuelve como mucho SHOWCASE_LIMIT elementos', async () => {
    prisma.media.findMany.mockResolvedValue([...videos(3), ...photos(50)]);

    const out = await service.listShowcase();

    expect(out).toHaveLength(SHOWCASE_LIMIT);
  });

  it('acota los videos a 4 como máximo; el resto son fotos', async () => {
    prisma.media.findMany.mockResolvedValue([...videos(10), ...photos(50)]);

    const out = await service.listShowcase();

    const vids = out.filter((m) => m.kind === 'video');
    expect(vids).toHaveLength(4);
    expect(out).toHaveLength(SHOWCASE_LIMIT);
  });

  it('intercala los videos en vez de amontonarlos al inicio', async () => {
    prisma.media.findMany.mockResolvedValue([...videos(3), ...photos(50)]);

    const out = await service.listShowcase();
    const videoPositions = out
      .map((m, i) => (m.kind === 'video' ? i : -1))
      .filter((i) => i >= 0);

    // 3 videos en 20 hojas: ninguno debería quedar pegado al principio en bloque.
    expect(videoPositions).toHaveLength(3);
    expect(videoPositions[0]).toBeGreaterThan(0);
    expect(Math.max(...videoPositions)).toBeGreaterThan(9);
  });

  it('un elemento de video trae la URL del HLS y el póster, no el master', async () => {
    prisma.media.findMany.mockResolvedValue([...videos(1), ...photos(30)]);

    const out = await service.listShowcase();
    const video = out.find((m) => m.kind === 'video');

    expect(video?.urls.hls).toBe('https://cdn.test/hls-v0/master.m3u8');
    expect(video?.urls.small).toBe('https://cdn.test/poster-v0.webp');
    expect(video?.urls).not.toHaveProperty('original');
    expect(video?.durationMs).toBe(12_000);
  });

  it('acota un limit disparatado al rango [1, 48]', async () => {
    prisma.media.findMany.mockResolvedValue(photos(100));

    const out = await service.listShowcase(999);

    expect(out).toHaveLength(48);
    expect(prisma.media.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(120);
  });

  it('descarta un video publicado sin derivados ni HLS (transcode a medias)', async () => {
    const brokenVideo = mediaRow({
      media_id: 'v-broken',
      kind: 'video',
      storage_key: null,
      hls_manifest_key: null,
      variants: [],
    });
    prisma.media.findMany.mockResolvedValue([
      brokenVideo,
      ...videos(2),
      ...photos(30),
    ]);

    const out = await service.listShowcase();

    expect(out.some((m) => m.mediaId === 'v-broken')).toBe(false);
    expect(out.filter((m) => m.kind === 'video')).toHaveLength(2);
    expect(out).toHaveLength(SHOWCASE_LIMIT);
  });

  it('funciona sin ningún video publicado (solo fotos)', async () => {
    prisma.media.findMany.mockResolvedValue(photos(25));

    const out = await service.listShowcase();

    expect(out).toHaveLength(SHOWCASE_LIMIT);
    expect(out.every((m) => m.kind === 'photo')).toBe(true);
  });
});
