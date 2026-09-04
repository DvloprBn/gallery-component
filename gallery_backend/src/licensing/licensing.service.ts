import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { escapeHtml } from '../common/utils/escape-html.util';
import { MailService } from '../mail/mail.service';
import { SiteService } from '../site/site.service';
import { StorageService } from '../storage/storage.service';
import type {
  QuoteLicenseRequestDto,
  SubmitLicenseRequestDto,
} from './dto/license-request.dto';

/** Estados desde los que todavía se puede (re)cotizar una solicitud. */
const QUOTABLE_STATUSES = new Set(['new', 'quoted']);

/** Una solicitud de licencia tal como la ve el panel — con el contexto de la foto y su cotización. */
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
  quotedPrice: string | null;
  quotedConditions: string | null;
  quoteExpiresAt: Date | null;
  quotedAt: Date | null;
}

/** Lo que necesita `toView` de una fila — evita depender del tipo inferido de Prisma. */
interface RequestRow {
  request_id: string;
  image_id: string;
  requester_name: string;
  requester_email: string;
  intended_use: string;
  message: string;
  budget: string | null;
  status: string;
  created_at: Date;
  quoted_price: string | null;
  quoted_conditions: string | null;
  quote_expires_at: Date | null;
  quoted_at: Date | null;
  image: {
    album: { title: string; slug: string };
    variants: { label: string; storage_key: string }[];
  };
}

/**
 * Solicitudes de licencia sobre fotos publicadas. Fase 12a (captura + aviso) +
 * Fase 12b (cotizar). Emitir la licencia y entregar el archivo firmado de un
 * solo uso son fases posteriores (12c).
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
    return rows.map((r) => this.toView(r));
  }

  /**
   * Cotiza una solicitud: precio + condiciones + hasta cuándo es válida la
   * oferta. Avisa al solicitante por correo. Se puede recotizar mientras no
   * se haya aceptado/rechazado/entregado.
   *
   * @throws NotFoundException si la solicitud no existe.
   * @throws BadRequestException si ya está aceptada, rechazada o entregada
   *         — esos estados ya no admiten una cotización nueva.
   */
  async quote(
    requestId: string,
    dto: QuoteLicenseRequestDto,
  ): Promise<LicenseRequestView> {
    const existing = await this.prisma.license_requests.findUnique({
      where: { request_id: requestId },
      include: { image: { include: { album: { select: { title: true, slug: true } } } } },
    });
    if (!existing) {
      throw new NotFoundException('Solicitud no encontrada.');
    }
    if (!QUOTABLE_STATUSES.has(existing.status)) {
      throw new BadRequestException(
        'Esta solicitud ya no se puede cotizar (ya fue aceptada, rechazada o entregada).',
      );
    }

    const updated = await this.prisma.license_requests.update({
      where: { request_id: requestId },
      data: {
        status: 'quoted',
        quoted_price: dto.price.trim(),
        quoted_conditions: dto.conditions?.trim() || null,
        quote_expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
        quoted_at: new Date(),
      },
      include: {
        image: {
          include: {
            album: { select: { title: true, slug: true } },
            variants: true,
          },
        },
      },
    });

    await this.mail.send(
      updated.requester_email,
      `Cotización de licencia — ${escapeHtml(existing.image.album.title)}`,
      `<p>Hola ${escapeHtml(updated.requester_name)},</p>` +
        `<p>Aquí está la cotización para tu solicitud sobre «${escapeHtml(existing.image.album.title)}»:</p>` +
        `<p><strong>Precio:</strong> ${escapeHtml(dto.price)}</p>` +
        (dto.conditions
          ? `<p><strong>Condiciones:</strong> ${escapeHtml(dto.conditions)}</p>`
          : '') +
        (dto.expiresAt
          ? `<p><strong>Esta cotización es válida hasta:</strong> ${escapeHtml(
              new Date(dto.expiresAt).toLocaleDateString('es-MX'),
            )}</p>`
          : ''),
    );

    return this.toView(updated);
  }

  /** Proyecta una fila (con sus relaciones ya incluidas) a la forma del panel. */
  private toView(row: RequestRow): LicenseRequestView {
    const thumb = row.image.variants.find((v) => v.label === 'thumb');
    return {
      requestId: row.request_id,
      imageId: row.image_id,
      imageThumbUrl: thumb ? this.storage.urlFor(thumb.storage_key, 'public') : null,
      collectionTitle: row.image.album.title,
      collectionSlug: row.image.album.slug,
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
      intendedUse: row.intended_use,
      message: row.message,
      budget: row.budget,
      status: row.status,
      createdAt: row.created_at,
      quotedPrice: row.quoted_price,
      quotedConditions: row.quoted_conditions,
      quoteExpiresAt: row.quote_expires_at,
      quotedAt: row.quoted_at,
    };
  }
}
