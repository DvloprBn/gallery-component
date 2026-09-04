import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { SiteService } from './site.service';

/**
 * Fila de `site_settings` con todo en blanco — la forma que devuelve Prisma
 * para el `upsert` del singleton.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    site_title: 'Portafolio',
    owner_name: '',
    tagline: '',
    bio: '',
    about_body: '',
    contact_email: '',
    contact_intro: '',
    instagram: '',
    hero_image_id: null,
    watermark_asset_key: '',
    watermark_text: '',
    watermark_opacity: 0.35,
    watermark_placement: 'tiled',
    rights_holder: '',
    creator: '',
    credit_line: '',
    rights_statement: '',
    default_license_terms: '',
    licensor_url: '',
    updated_at: new Date(),
    ...overrides,
  };
}

describe('SiteService', () => {
  let prisma: {
    site_settings: { upsert: jest.Mock; findUnique: jest.Mock };
    images: { findUnique: jest.Mock; findFirst: jest.Mock };
  };
  let storage: { urlFor: jest.Mock; read: jest.Mock };
  let service: SiteService;

  beforeEach(() => {
    prisma = {
      site_settings: {
        upsert: jest.fn().mockResolvedValue(row()),
        findUnique: jest.fn().mockResolvedValue(row()),
      },
      images: { findUnique: jest.fn(), findFirst: jest.fn() },
    };
    storage = {
      urlFor: jest.fn((key: string) => `https://cdn.test/${key}`),
      read: jest.fn().mockResolvedValue(null),
    };
    service = new SiteService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      {} as never, // watermark (WatermarkService)
      {} as never, // metadata (RightsMetadataService)
      {} as never, // pipeline (ImagePipelineService)
    );
  });

  it('get() hace upsert del singleton id=1 y proyecta sin campos internos', async () => {
    const result = await service.get();

    expect(prisma.site_settings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'aboutBody',
        'bio',
        'contactEmail',
        'contactIntro',
        'hero',
        'instagram',
        'ownerName',
        'rights',
        'siteTitle',
        'tagline',
        'watermark',
      ].sort(),
    );
    // no filtra la columna `id` ni `updated_at`
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('update() mapea camelCase → snake_case y solo manda los campos presentes', async () => {
    await service.update({ ownerName: 'Mara', contactEmail: 'hola@x.mx' });

    const call = prisma.site_settings.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ owner_name: 'Mara', contact_email: 'hola@x.mx' });
    expect(call.update).not.toHaveProperty('tagline');
  });

  it('update() rechaza un heroImageId que no existe (sin escribir)', async () => {
    prisma.images.findUnique.mockResolvedValue(null);

    await expect(
      service.update({ heroImageId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site_settings.upsert).not.toHaveBeenCalled();
  });

  it('update() rechaza un hero cuyo álbum NO es público (sin escribir)', async () => {
    prisma.images.findUnique.mockResolvedValue({
      image_id: 'img-1',
      status: 'published',
      album: { visibility: 'unlisted' },
    });

    await expect(
      service.update({ heroImageId: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site_settings.upsert).not.toHaveBeenCalled();
  });

  it('update() rechaza un hero que no está publicado (sin escribir)', async () => {
    prisma.images.findUnique.mockResolvedValue({
      image_id: 'img-1',
      status: 'draft',
      album: { visibility: 'public' },
    });

    await expect(
      service.update({ heroImageId: '44444444-4444-4444-8444-444444444444' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site_settings.upsert).not.toHaveBeenCalled();
  });

  it('update() acepta un hero publicado de un álbum público', async () => {
    prisma.images.findUnique.mockResolvedValue({
      image_id: 'img-1',
      status: 'published',
      album: { visibility: 'public' },
    });
    // toPublic() resuelve el hero con findFirst (solo si sigue publicado)
    prisma.images.findFirst.mockResolvedValue({
      image_id: 'img-1',
      storage_key: 'orig.webp',
      width: 1600,
      height: 1067,
      placeholder: 'blur',
      variants: [{ label: 'large', storage_key: 'large.webp' }],
    });
    prisma.site_settings.upsert.mockResolvedValue(row({ hero_image_id: 'img-1' }));

    const result = await service.update({
      heroImageId: '33333333-3333-4333-8333-333333333333',
    });

    expect(prisma.site_settings.upsert.mock.calls[0][0].update).toEqual({
      hero_image_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.hero).toMatchObject({
      imageId: 'img-1',
      width: 1600,
      urls: { original: 'https://cdn.test/orig.webp', large: 'https://cdn.test/large.webp' },
    });
  });

  it('update({ heroImageId: null }) limpia el hero sin validar nada', async () => {
    await service.update({ heroImageId: null });

    expect(prisma.images.findUnique).not.toHaveBeenCalled();
    expect(prisma.site_settings.upsert.mock.calls[0][0].update).toEqual({
      hero_image_id: null,
    });
  });

  it('toPublic() proyecta la marca de agua sin logo (texto de respaldo con el nombre del sitio)', async () => {
    prisma.site_settings.upsert.mockResolvedValue(
      row({ owner_name: 'Mara Solís' }),
    );

    const result = await service.get();

    expect(result.watermark).toEqual({
      hasAsset: false,
      previewUrl: null,
      text: '© Mara Solís',
      opacity: 0.35,
      placement: 'tiled',
    });
  });

  it('toPublic() proyecta previewUrl cuando hay un logo subido', async () => {
    prisma.site_settings.upsert.mockResolvedValue(
      row({ watermark_asset_key: 'wm/logo.png' }),
    );

    const result = await service.get();

    expect(result.watermark.hasAsset).toBe(true);
    expect(result.watermark.previewUrl).toBe('https://cdn.test/wm/logo.png');
  });

  it('toPublic() calcula el aviso de derechos por defecto si no hay uno explícito', async () => {
    prisma.site_settings.upsert.mockResolvedValue(
      row({ rights_holder: 'Mara Solís' }),
    );

    const result = await service.get();

    expect(result.rights.rightsHolder).toBe('Mara Solís');
    expect(result.rights.noticeText).toBe(
      `© Mara Solís ${new Date().getFullYear()}. Todos los derechos reservados.`,
    );
  });

  it('getWatermarkConfig() decodifica el logo si storage.read lo devuelve', async () => {
    const { Readable } = await import('node:stream');
    prisma.site_settings.upsert.mockResolvedValue(
      row({ watermark_asset_key: 'wm/logo.png', watermark_opacity: 0.5 }),
    );
    storage.read.mockResolvedValue({
      stream: Readable.from([Buffer.from('fake-png-bytes')]),
      contentType: 'image/png',
      bytes: 14,
    });

    const config = await service.getWatermarkConfig();

    expect(config.assetBuffer?.toString()).toBe('fake-png-bytes');
    expect(config.opacity).toBe(0.5);
  });

  it('getRightsDefaults() rellena creator/rightsHolder desde ownerName si faltan', async () => {
    prisma.site_settings.upsert.mockResolvedValue(
      row({ owner_name: 'Mara Solís' }),
    );

    const rights = await service.getRightsDefaults();

    expect(rights.rightsHolder).toBe('Mara Solís');
    expect(rights.creator).toBe('Mara Solís');
  });

  describe('regeneración en segundo plano', () => {
    it('arranca "running" de inmediato, sin esperar al trabajo', () => {
      const prismaAny = prisma as unknown as {
        images: { findMany: jest.Mock };
      };
      prismaAny.images = { findMany: jest.fn(() => new Promise(() => {})) }; // nunca resuelve

      const status = service.startWatermarkRegeneration();

      expect(status.status).toBe('running');
      expect(status.startedAt).not.toBeNull();
    });

    it('una segunda llamada mientras corre NO relanza — devuelve el estado en curso', () => {
      const prismaAny = prisma as unknown as {
        images: { findMany: jest.Mock };
      };
      prismaAny.images = { findMany: jest.fn(() => new Promise(() => {})) };

      const first = service.startWatermarkRegeneration();
      const second = service.startWatermarkRegeneration();

      expect(prismaAny.images.findMany).toHaveBeenCalledTimes(1);
      expect(second.startedAt).toBe(first.startedAt);
    });

    it('getWatermarkRegenerationStatus() empieza en "idle"', () => {
      expect(service.getWatermarkRegenerationStatus().status).toBe('idle');
    });

    it('si la consulta inicial falla, el estado pasa a "error" (no queda "running" para siempre)', async () => {
      const prismaAny = prisma as unknown as {
        images: { findMany: jest.Mock };
      };
      prismaAny.images = {
        findMany: jest.fn().mockRejectedValue(new Error('boom')),
      };

      service.startWatermarkRegeneration();
      await new Promise((r) => setImmediate(r)); // deja correr el fire-and-forget

      const status = service.getWatermarkRegenerationStatus();
      expect(status.status).toBe('error');
      expect(status.error).toBe('boom');
      expect(status.finishedAt).not.toBeNull();
    });
  });
});
