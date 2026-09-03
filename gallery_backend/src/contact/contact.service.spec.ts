import type { PrismaService } from '../common/prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import { ContactService } from './contact.service';

describe('ContactService', () => {
  let prisma: {
    contact_messages: {
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    site_settings: { findUnique: jest.Mock };
  };
  let mail: { send: jest.Mock };
  let service: ContactService;

  beforeEach(() => {
    prisma = {
      contact_messages: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      site_settings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    mail = { send: jest.fn().mockResolvedValue({ delivered: false }) };
    service = new ContactService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
    process.env.MAIL_FROM_ADDRESS = 'buzon@example.com';
  });

  it('honeypot: si `website` viene relleno, NO guarda ni envía nada', async () => {
    const result = await service.submit(
      { name: 'Bot', email: 'bot@x.com', message: 'spam', website: 'http://spam' },
      '9.9.9.9',
    );

    expect(result).toEqual({ ok: true });
    expect(prisma.contact_messages.create).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('normaliza los datos y registra la IP solo en la fila', async () => {
    await service.submit(
      { name: '  Ana  ', email: '  ANA@Example.COM ', message: '  hola mundo  ' },
      '203.0.113.7',
    );

    expect(prisma.contact_messages.create).toHaveBeenCalledWith({
      data: {
        name: 'Ana',
        email: 'ana@example.com',
        body: 'hola mundo',
        ip_address: '203.0.113.7',
      },
    });
  });

  it('sin IP disponible guarda `ip_address: null`', async () => {
    await service.submit({ name: 'A', email: 'a@b.com', message: 'x' });
    expect(prisma.contact_messages.create.mock.calls[0][0].data.ip_address).toBeNull();
  });

  it('escapa el contenido del usuario en el correo (anti-XSS almacenado)', async () => {
    await service.submit(
      {
        name: '<script>alert(1)</script>',
        email: 'x@y.com',
        message: '<img src=x onerror=alert(2)>',
      },
      '1.1.1.1',
    );

    const [, subject, html] = mail.send.mock.calls[0];
    expect(subject).not.toContain('<script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('elige el destinatario de site_settings.contact_email si existe', async () => {
    prisma.site_settings.findUnique.mockResolvedValue({ contact_email: '  foto@studio.mx ' });
    await service.submit({ name: 'A', email: 'a@b.com', message: 'x' }, '1.1.1.1');
    expect(mail.send.mock.calls[0][0]).toBe('foto@studio.mx');
  });

  it('cae a MAIL_FROM_ADDRESS si no hay contact_email configurado', async () => {
    prisma.site_settings.findUnique.mockResolvedValue({ contact_email: '   ' });
    await service.submit({ name: 'A', email: 'a@b.com', message: 'x' }, '1.1.1.1');
    expect(mail.send.mock.calls[0][0]).toBe('buzon@example.com');
  });

  it('list() proyecta a MessageView sin exponer ip_address', async () => {
    prisma.contact_messages.findMany.mockResolvedValue([
      {
        message_id: 'm1',
        name: 'A',
        email: 'a@b.com',
        body: 'hola',
        ip_address: '203.0.113.7',
        is_read: false,
        created_at: new Date('2026-09-02T00:00:00Z'),
      },
    ]);

    const [view] = await service.list();

    expect(view).toEqual({
      messageId: 'm1',
      name: 'A',
      email: 'a@b.com',
      body: 'hola',
      isRead: false,
      createdAt: new Date('2026-09-02T00:00:00Z'),
    });
    expect(view).not.toHaveProperty('ipAddress');
    expect(view).not.toHaveProperty('ip_address');
    expect(prisma.contact_messages.findMany).toHaveBeenCalledWith({
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  });

  it('markRead / remove usan updateMany / deleteMany acotados por id', async () => {
    await service.markRead('m1', true);
    expect(prisma.contact_messages.updateMany).toHaveBeenCalledWith({
      where: { message_id: 'm1' },
      data: { is_read: true },
    });

    await service.remove('m1');
    expect(prisma.contact_messages.deleteMany).toHaveBeenCalledWith({
      where: { message_id: 'm1' },
    });
  });
});
