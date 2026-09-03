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
    updated_at: new Date(),
    ...overrides,
  };
}

describe('SiteService', () => {
  let prisma: {
    site_settings: { upsert: jest.Mock };
    images: { findUnique: jest.Mock };
  };
  let storage: { urlFor: jest.Mock };
  let service: SiteService;

  beforeEach(() => {
    prisma = {
      site_settings: { upsert: jest.fn().mockResolvedValue(row()) },
      images: { findUnique: jest.fn() },
    };
    storage = { urlFor: jest.fn((key: string) => `https://cdn.test/${key}`) };
    service = new SiteService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
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
        'siteTitle',
        'tagline',
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
      album: { visibility: 'unlisted' },
    });

    await expect(
      service.update({ heroImageId: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site_settings.upsert).not.toHaveBeenCalled();
  });

  it('update() acepta un hero de un álbum público', async () => {
    prisma.images.findUnique
      .mockResolvedValueOnce({ image_id: 'img-1', album: { visibility: 'public' } })
      .mockResolvedValueOnce({
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
});
