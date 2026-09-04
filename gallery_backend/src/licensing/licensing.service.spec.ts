import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { SiteService } from '../site/site.service';
import type { StorageService } from '../storage/storage.service';
import { LicensingService } from './licensing.service';

const publicPublishedImage = {
  image_id: 'img-1',
  status: 'published',
  album: { visibility: 'public', title: 'Calle', slug: 'calle-abc' },
};

const validDto = {
  imageId: '11111111-1111-4111-8111-111111111111',
  name: 'Editor XYZ',
  email: 'editor@revista.com',
  intendedUse: 'editorial' as const,
  message: 'Queremos usarla en un reportaje sobre skate en Querétaro.',
};

describe('LicensingService', () => {
  let prisma: {
    images: { findUnique: jest.Mock };
    license_requests: { create: jest.Mock; findMany: jest.Mock };
  };
  let mail: { send: jest.Mock };
  let site: { get: jest.Mock };
  let storage: { urlFor: jest.Mock };
  let service: LicensingService;

  beforeEach(() => {
    prisma = {
      images: { findUnique: jest.fn().mockResolvedValue(publicPublishedImage) },
      license_requests: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    mail = { send: jest.fn().mockResolvedValue({ delivered: false }) };
    site = { get: jest.fn().mockResolvedValue({ contactEmail: 'mara@example.com' }) };
    storage = { urlFor: jest.fn((key: string) => `https://cdn.test/${key}`) };
    service = new LicensingService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      site as unknown as SiteService,
      storage as unknown as StorageService,
    );
    process.env.MAIL_FROM_ADDRESS = 'buzon@example.com';
  });

  it('rechaza una foto inexistente (sin guardar ni avisar)', async () => {
    prisma.images.findUnique.mockResolvedValue(null);
    await expect(service.submit(validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('rechaza una foto no publicada (borrador/archivada)', async () => {
    prisma.images.findUnique.mockResolvedValue({ ...publicPublishedImage, status: 'draft' });
    await expect(service.submit(validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
  });

  it('rechaza una foto de álbum no público', async () => {
    prisma.images.findUnique.mockResolvedValue({
      ...publicPublishedImage,
      album: { ...publicPublishedImage.album, visibility: 'unlisted' },
    });
    await expect(service.submit(validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
  });

  it('honeypot: si `website` viene relleno, NO guarda ni envía nada', async () => {
    const result = await service.submit({ ...validDto, website: 'http://spam' }, '9.9.9.9');
    expect(result).toEqual({ ok: true });
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('guarda la solicitud normalizada y avisa por correo', async () => {
    await service.submit({ ...validDto, name: '  Editor XYZ  ', email: ' EDITOR@Revista.com ' }, '203.0.113.7');

    expect(prisma.license_requests.create).toHaveBeenCalledWith({
      data: {
        image_id: 'img-1',
        requester_name: 'Editor XYZ',
        requester_email: 'editor@revista.com',
        intended_use: 'editorial',
        message: validDto.message,
        budget: null,
        ip_address: '203.0.113.7',
      },
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0]).toBe('mara@example.com');
  });

  it('escapa el contenido del usuario en el correo (anti-XSS almacenado)', async () => {
    await service.submit({
      ...validDto,
      name: '<script>alert(1)</script>',
      message: '<img src=x onerror=alert(2)> ' + validDto.message,
    });
    const html = mail.send.mock.calls[0][2];
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('cae a MAIL_FROM_ADDRESS si el sitio no tiene contactEmail configurado', async () => {
    site.get.mockResolvedValue({ contactEmail: '' });
    await service.submit(validDto);
    expect(mail.send.mock.calls[0][0]).toBe('buzon@example.com');
  });

  it('list() resuelve la miniatura y el contexto de la colección', async () => {
    prisma.license_requests.findMany.mockResolvedValue([
      {
        request_id: 'r1',
        image_id: 'img-1',
        requester_name: 'Editor XYZ',
        requester_email: 'editor@revista.com',
        intended_use: 'editorial',
        message: 'hola',
        budget: '$500 USD',
        status: 'new',
        created_at: new Date('2026-09-04T00:00:00Z'),
        image: {
          album: { title: 'Calle', slug: 'calle-abc' },
          variants: [{ label: 'thumb', storage_key: 'thumb.webp' }],
        },
      },
    ]);

    const [view] = await service.list();

    expect(view).toMatchObject({
      requestId: 'r1',
      collectionTitle: 'Calle',
      collectionSlug: 'calle-abc',
      imageThumbUrl: 'https://cdn.test/thumb.webp',
      budget: '$500 USD',
    });
  });
});
