import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { RightsMetadataService } from '../protection/rights-metadata.service';
import type { SiteService } from '../site/site.service';
import type { StorageService } from '../storage/storage.service';
import { LicensingService } from './licensing.service';

const publicPublishedMedia = {
  media_id: 'img-1',
  status: 'published',
  album: { visibility: 'public', title: 'Calle', slug: 'calle-abc' },
};

const validDto = {
  mediaId: '11111111-1111-4111-8111-111111111111',
  name: 'Editor XYZ',
  email: 'editor@revista.com',
  intendedUse: 'editorial' as const,
  message: 'Queremos usarla en un reportaje sobre skate en Querétaro.',
};

describe('LicensingService', () => {
  let prisma: {
    media: { findUnique: jest.Mock };
    license_requests: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    licenses: { create: jest.Mock };
    delivery_tokens: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mail: { send: jest.Mock };
  let site: { get: jest.Mock; getRightsDefaults: jest.Mock };
  let storage: { urlFor: jest.Mock; read: jest.Mock };
  let metadata: { embed: jest.Mock };
  let service: LicensingService;

  const quotableRow = {
    request_id: 'r1',
    requester_name: 'Editor XYZ',
    requester_email: 'editor@revista.com',
    status: 'new',
    media: { album: { title: 'Calle', slug: 'calle-abc' }, variants: [] },
    license: null,
  };

  beforeEach(() => {
    prisma = {
      media: { findUnique: jest.fn().mockResolvedValue(publicPublishedMedia) },
      license_requests: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(quotableRow),
        findUniqueOrThrow: jest.fn().mockResolvedValue(quotableRow),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...quotableRow,
            ...data,
            media: { ...quotableRow.media, variants: [] },
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      licenses: { create: jest.fn().mockResolvedValue({ license_id: 'lic-1' }) },
      delivery_tokens: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation((fn) => fn(prisma)),
    };
    mail = { send: jest.fn().mockResolvedValue({ delivered: false }) };
    site = {
      get: jest.fn().mockResolvedValue({ contactEmail: 'mara@example.com' }),
      getRightsDefaults: jest.fn().mockResolvedValue({
        rightsHolder: 'Mara Solís',
        creator: 'Mara Solís',
        creditLine: '',
        rightsStatement: '© Mara Solís',
        licenseTerms: '',
        licensorUrl: '',
      }),
    };
    storage = {
      urlFor: jest.fn((key: string) => `https://cdn.test/${key}`),
      read: jest.fn().mockResolvedValue({
        stream: Readable.from([Buffer.from('clean-original-bytes')]),
        contentType: 'image/jpeg',
        bytes: 21,
      }),
    };
    metadata = { embed: jest.fn().mockImplementation((buf) => Promise.resolve(buf)) };
    service = new LicensingService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      site as unknown as SiteService,
      storage as unknown as StorageService,
      metadata as unknown as RightsMetadataService,
    );
    process.env.MAIL_FROM_ADDRESS = 'buzon@example.com';
    process.env.BACKEND_URL = 'http://localhost:3050';
  });

  it('rechaza una foto inexistente (sin guardar ni avisar)', async () => {
    prisma.media.findUnique.mockResolvedValue(null);
    await expect(service.submit(validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('rechaza una foto no publicada (borrador/archivada)', async () => {
    prisma.media.findUnique.mockResolvedValue({ ...publicPublishedMedia, status: 'draft' });
    await expect(service.submit(validDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.license_requests.create).not.toHaveBeenCalled();
  });

  it('rechaza una foto de álbum no público', async () => {
    prisma.media.findUnique.mockResolvedValue({
      ...publicPublishedMedia,
      album: { ...publicPublishedMedia.album, visibility: 'unlisted' },
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
        media_id: 'img-1',
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
        media_id: 'img-1',
        requester_name: 'Editor XYZ',
        requester_email: 'editor@revista.com',
        intended_use: 'editorial',
        message: 'hola',
        budget: '$500 USD',
        status: 'new',
        created_at: new Date('2026-09-04T00:00:00Z'),
        media: {
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
      mediaThumbUrl: 'https://cdn.test/thumb.webp',
      budget: '$500 USD',
    });
  });

  describe('quote()', () => {
    it('rechaza una solicitud inexistente', async () => {
      prisma.license_requests.findUnique.mockResolvedValue(null);
      await expect(
        service.quote('r1', { price: '$500 USD' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.license_requests.update).not.toHaveBeenCalled();
    });

    it('rechaza cotizar una solicitud ya aceptada/rechazada/entregada', async () => {
      prisma.license_requests.findUnique.mockResolvedValue({
        ...quotableRow,
        status: 'accepted',
      });
      await expect(
        service.quote('r1', { price: '$500 USD' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.license_requests.update).not.toHaveBeenCalled();
    });

    it('permite recotizar una solicitud ya cotizada (no solo "new")', async () => {
      prisma.license_requests.findUnique.mockResolvedValue({
        ...quotableRow,
        status: 'quoted',
      });
      await expect(
        service.quote('r1', { price: '$600 USD' }),
      ).resolves.toBeDefined();
      expect(prisma.license_requests.update).toHaveBeenCalled();
    });

    it('guarda la cotización y pasa el estado a "quoted"', async () => {
      const result = await service.quote('r1', {
        price: '$500 USD',
        conditions: 'Uso editorial, un año, con crédito.',
        expiresAt: '2026-12-31',
      });

      const call = prisma.license_requests.update.mock.calls[0][0];
      expect(call.where).toEqual({ request_id: 'r1' });
      expect(call.data).toMatchObject({
        status: 'quoted',
        quoted_price: '$500 USD',
        quoted_conditions: 'Uso editorial, un año, con crédito.',
      });
      expect(call.data.quote_expires_at).toBeInstanceOf(Date);
      expect(call.data.quoted_at).toBeInstanceOf(Date);
      expect(result.status).toBe('quoted');
    });

    it('avisa al solicitante por correo con el precio (escapado)', async () => {
      await service.quote('r1', {
        price: '$500 USD',
        conditions: '<script>alert(1)</script>',
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = mail.send.mock.calls[0];
      expect(to).toBe('editor@revista.com');
      expect(subject).toContain('Calle');
      expect(html).toContain('$500 USD');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('condiciones/vigencia vacías son opcionales — no truena', async () => {
      await expect(service.quote('r1', { price: '$500' })).resolves.toBeDefined();
      expect(
        prisma.license_requests.update.mock.calls[0][0].data.quoted_conditions,
      ).toBeNull();
      expect(
        prisma.license_requests.update.mock.calls[0][0].data.quote_expires_at,
      ).toBeNull();
    });
  });

  describe('accept()', () => {
    it('rechaza una solicitud inexistente', async () => {
      prisma.license_requests.findUnique.mockResolvedValue(null);
      await expect(service.accept('r1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.licenses.create).not.toHaveBeenCalled();
    });

    it('rechaza aceptar una solicitud que todavía no tiene cotización', async () => {
      prisma.license_requests.findUnique.mockResolvedValue({ ...quotableRow, status: 'new' });
      await expect(service.accept('r1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.licenses.create).not.toHaveBeenCalled();
    });

    it('emite la licencia, el token de entrega, y avisa por correo con el enlace', async () => {
      prisma.license_requests.findUnique.mockResolvedValue({
        ...quotableRow,
        status: 'quoted',
        quoted_price: '$500 USD',
        quoted_conditions: 'Uso editorial',
      });

      await service.accept('r1');

      expect(prisma.licenses.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          request_id: 'r1',
          licensee_email: 'editor@revista.com',
          price: '$500 USD',
        }),
      });
      expect(prisma.delivery_tokens.create).toHaveBeenCalled();
      expect(
        prisma.license_requests.update,
      ).toHaveBeenCalledWith({
        where: { request_id: 'r1' },
        data: { status: 'accepted' },
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
      const [to, , html] = mail.send.mock.calls[0];
      expect(to).toBe('editor@revista.com');
      expect(html).toContain('http://localhost:3050/deliveries/');
    });
  });

  describe('consumeDelivery()', () => {
    const validToken = {
      delivery_token_id: 'dt-1',
      used_at: null,
      expires_at: new Date(Date.now() + 86_400_000),
      license: {
        license_id: 'lic-1',
        licensee_name: 'Editor XYZ',
        licensee_email: 'editor@revista.com',
        intended_use: 'editorial',
        conditions: null,
        request_id: 'r1',
        media: { storage_key: 'orig.jpg', mime_type: 'image/jpeg', rights: null },
      },
    };

    it('token inexistente -> 404', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue(null);
      await expect(service.consumeDelivery('bad')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.delivery_tokens.updateMany).not.toHaveBeenCalled();
    });

    it('token ya usado -> 404 (sin volver a marcarlo ni servir el archivo)', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue({
        ...validToken,
        used_at: new Date(),
      });
      await expect(service.consumeDelivery('used')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.delivery_tokens.updateMany).not.toHaveBeenCalled();
      expect(storage.read).not.toHaveBeenCalled();
    });

    it('token caducado -> 404', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue({
        ...validToken,
        expires_at: new Date(Date.now() - 1000),
      });
      await expect(service.consumeDelivery('expired')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.read).not.toHaveBeenCalled();
    });

    it('la carrera de dos descargas simultáneas: la segunda pierde el "claim" atómico -> 404', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue(validToken);
      prisma.delivery_tokens.updateMany.mockResolvedValue({ count: 0 }); // otra petición ya lo marcó
      await expect(service.consumeDelivery('raw')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.read).not.toHaveBeenCalled();
    });

    it('sirve el archivo, marca la solicitud como "fulfilled" e incrusta al licenciatario en los metadatos', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue(validToken);

      const result = await service.consumeDelivery('raw-token');

      expect(prisma.delivery_tokens.updateMany).toHaveBeenCalledWith({
        where: { delivery_token_id: 'dt-1', used_at: null },
        data: { used_at: expect.any(Date) },
      });
      expect(storage.read).toHaveBeenCalledWith('orig.jpg');
      expect(metadata.embed).toHaveBeenCalledWith(
        expect.any(Buffer),
        'jpeg',
        expect.objectContaining({
          rightsStatement: expect.stringContaining('Editor XYZ'),
        }),
      );
      expect(prisma.license_requests.updateMany).toHaveBeenCalledWith({
        where: { request_id: 'r1' },
        data: { status: 'fulfilled' },
      });
      expect(result.filename).toMatch(/^licencia-.*\.jpg$/);
      expect(result.contentType).toBe('image/jpeg');
    });

    it('para un VIDEO entrega el master MP4: `format: mp4`, nombre `.mp4`, derechos + licenciatario (Fase 14d)', async () => {
      prisma.delivery_tokens.findUnique.mockResolvedValue({
        ...validToken,
        license: {
          ...validToken.license,
          conditions: 'Uso web, 1 año',
          media: { kind: 'video', storage_key: 'master.mp4', mime_type: 'video/mp4', rights: null },
        },
      });
      storage.read.mockResolvedValue({
        stream: Readable.from(Buffer.from('mp4-bytes')),
        contentType: 'video/mp4',
        bytes: 9,
      });

      const result = await service.consumeDelivery('raw-token');

      expect(storage.read).toHaveBeenCalledWith('master.mp4');
      expect(metadata.embed).toHaveBeenCalledWith(
        expect.any(Buffer),
        'mp4',
        expect.objectContaining({
          rightsStatement: expect.stringContaining('Editor XYZ'),
        }),
      );
      expect(result.filename).toMatch(/^licencia-.*\.mp4$/);
      expect(result.contentType).toBe('video/mp4');
    });
  });
});
