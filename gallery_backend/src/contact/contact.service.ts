import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { escapeHtml } from '../common/utils/escape-html.util';
import { MailService } from '../mail/mail.service';

/** Un mensaje de contacto tal como lo ve el panel. */
export interface MessageView {
  messageId: string;
  name: string;
  email: string;
  body: string;
  isRead: boolean;
  createdAt: Date;
}

/**
 * Formulario de contacto público: guarda el mensaje (para revisarlo en el
 * panel) e intenta avisar por correo al fotógrafo. El envío degrada con
 * elegancia — si el correo falla, el mensaje ya quedó guardado.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Recibe un mensaje del formulario.
   *
   * @param dto - `name` + `email` + `message` (+ `website` honeypot).
   * @param ip - IP de origen (solo para el registro interno).
   * @returns `{ ok: true }` siempre (no revela si el honeypot se activó).
   */
  async submit(
    dto: { name: string; email: string; message: string; website?: string },
    ip?: string,
  ): Promise<{ ok: true }> {
    // Honeypot: un bot rellenó el campo oculto → se acepta y se descarta.
    if (dto.website && dto.website.trim() !== '') {
      this.logger.warn(`Contacto descartado por honeypot (ip=${ip ?? '-'}).`);
      return { ok: true };
    }

    await this.prisma.contact_messages.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        body: dto.message.trim(),
        ip_address: ip ?? null,
      },
    });

    const settings = await this.prisma.site_settings.findUnique({
      where: { id: 1 },
    });
    const to =
      settings?.contact_email?.trim() ||
      process.env.MAIL_FROM_ADDRESS ||
      'no-reply@example.com';

    await this.mail.send(
      to,
      `Nuevo mensaje de ${escapeHtml(dto.name)} (${escapeHtml(dto.email)})`,
      `<p><strong>${escapeHtml(dto.name)}</strong> &lt;${escapeHtml(dto.email)}&gt; escribió:</p>` +
        `<blockquote>${escapeHtml(dto.message)}</blockquote>`,
    );

    return { ok: true };
  }

  /** Lista los mensajes, más recientes primero (para el panel). */
  async list(): Promise<MessageView[]> {
    const rows = await this.prisma.contact_messages.findMany({
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    return rows.map((m) => ({
      messageId: m.message_id,
      name: m.name,
      email: m.email,
      body: m.body,
      isRead: m.is_read,
      createdAt: m.created_at,
    }));
  }

  /** Marca (o desmarca) un mensaje como leído. */
  async markRead(messageId: string, read: boolean): Promise<{ ok: true }> {
    await this.prisma.contact_messages.updateMany({
      where: { message_id: messageId },
      data: { is_read: read },
    });
    return { ok: true };
  }

  /** Borra un mensaje. */
  async remove(messageId: string): Promise<void> {
    await this.prisma.contact_messages.deleteMany({
      where: { message_id: messageId },
    });
  }
}
