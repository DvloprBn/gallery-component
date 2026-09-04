import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { escapeHtml } from '../common/utils/escape-html.util';
import { MailService } from '../mail/mail.service';
import { SiteService } from '../site/site.service';
import { StorageService } from '../storage/storage.service';
import type { SubmitLicenseRequestDto } from './dto/license-request.dto';

/** Una solicitud de licencia tal como la ve el panel — con el contexto de la foto. */
export interface LicenseRequestView {
  requestId: string;
  imageId: string;
  imageThumbUrl: string | null;
  collectionTitle: string;
  collectionSlug: string;
  requesterName: string;
  requesterEmail: string;
  intendedUse: string;
  message: string;
  budget: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Solicitudes de licencia sobre fotos publicadas (Fase 12a — primer tramo del
 * flujo solicitud → cotización → entrega). Por ahora solo captura y avisa;
 * cotizar/aceptar/entregar el archivo son fases posteriores.
 */
@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly site: SiteService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Recibe una solicitud del formulario público.
   *
   * @param dto - Foto + uso previsto + datos del solicitante (+ `website` honeypot).
   * @param ip - IP de origen (solo para el registro interno).
   * @returns `{ ok: true }` siempre que la foto sea válida (no revela si el
   *          honeypot se activó — mismo principio que `ContactService`).
   * @throws BadRequestException si la foto no existe, no está publicada o su
   *         álbum no es público — no se puede licenciar lo que no se exhibe.
   */
  async submit(
    dto: SubmitLicenseRequestDto,
    ip?: string,
  ): Promise<{ ok: true }> {
    const image = await this.prisma.images.findUnique({
      where: { image_id: dto.imageId },
      include: { album: { select: { visibility: true, title: true, slug: true } } },
    });
    if (!image || image.status !== 'published' || image.album.visibility !== 'public') {
      throw new BadRequestException(
        'Esa foto no está disponible para solicitar una licencia.',
      );
    }

    // Honeypot: un bot rellenó el campo oculto → se acepta y se descarta.
    if (dto.website && dto.website.trim() !== '') {
      this.logger.warn(`Solicitud de licencia descartada por honeypot (ip=${ip ?? '-'}).`);
      return { ok: true };
    }

    await this.prisma.license_requests.create({
      data: {
        image_id: image.image_id,
        requester_name: dto.name.trim(),
        requester_email: dto.email.toLowerCase().trim(),
        intended_use: dto.intendedUse,
        message: dto.message.trim(),
        budget: dto.budget?.trim() || null,
        ip_address: ip ?? null,
      },
    });

    const site = await this.site.get();
    const to = site.contactEmail || process.env.MAIL_FROM_ADDRESS || 'no-reply@example.com';

    await this.mail.send(
      to,
      `Solicitud de licencia — ${escapeHtml(image.album.title)}`,
      `<p><strong>${escapeHtml(dto.name)}</strong> &lt;${escapeHtml(dto.email)}&gt; pide licenciar ` +
        `una foto de «${escapeHtml(image.album.title)}» para uso <strong>${escapeHtml(dto.intendedUse)}</strong>:</p>` +
        `<blockquote>${escapeHtml(dto.message)}</blockquote>` +
        (dto.budget ? `<p>Presupuesto: ${escapeHtml(dto.budget)}</p>` : ''),
    );

    return { ok: true };
  }

  /** Lista las solicitudes, más recientes primero (para el panel). */
  async list(): Promise<LicenseRequestView[]> {
    const rows = await this.prisma.license_requests.findMany({
      orderBy: { created_at: 'desc' },
      take: 200,
      include: {
        image: {
          include: {
            album: { select: { title: true, slug: true } },
            variants: true,
          },
        },
      },
    });

    return rows.map((r) => {
      const thumb = r.image.variants.find((v) => v.label === 'thumb');
      return {
        requestId: r.request_id,
        imageId: r.image_id,
        imageThumbUrl: thumb ? this.storage.urlFor(thumb.storage_key, 'public') : null,
        collectionTitle: r.image.album.title,
        collectionSlug: r.image.album.slug,
        requesterName: r.requester_name,
        requesterEmail: r.requester_email,
        intendedUse: r.intended_use,
        message: r.message,
        budget: r.budget,
        status: r.status,
        createdAt: r.created_at,
      };
    });
  }
}
