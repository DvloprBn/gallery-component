import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { PrismaService } from '../common/prisma/prisma.service';
import { escapeHtml } from '../common/utils/escape-html.util';
import { streamToBuffer } from '../common/utils/stream.util';
import { generateOpaqueToken, sha256Hex } from '../common/utils/token.util';
import { MailService } from '../mail/mail.service';
import type { EmbeddableFormat } from '../protection/rights-metadata.service';
import { RightsMetadataService } from '../protection/rights-metadata.service';
import { resolveRights } from '../protection/rights.util';
import { SiteService } from '../site/site.service';
import { StorageService } from '../storage/storage.service';
import type {
  QuoteLicenseRequestDto,
  SubmitLicenseRequestDto,
} from './dto/license-request.dto';

/** Estados desde los que todavía se puede (re)cotizar una solicitud. */
const QUOTABLE_STATUSES = new Set(['new', 'quoted']);

/** Días que dura vigente un enlace de entrega antes de caducar (se consume en la primera descarga, lo que pase primero). */
const DELIVERY_TOKEN_TTL_DAYS = 14;

/** Estado de la entrega de una licencia, tal como lo ve el panel. */
export interface LicenseView {
  licenseId: string;
  issuedAt: Date;
  deliveryStatus: 'pending' | 'used' | 'expired';
  deliveryExpiresAt: Date;
}

/** Una solicitud de licencia tal como la ve el panel — con el contexto de la foto, su cotización y su licencia (si ya se emitió). */
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
  license: LicenseView | null;
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
  license: {
    license_id: string;
    issued_at: Date;
    delivery_tokens: { expires_at: Date; used_at: Date | null }[];
  } | null;
}

/** Los `include` que necesita `toView` — se repiten en `list`, `quote` y `accept`. */
const REQUEST_INCLUDE = {
  image: {
    include: {
      album: { select: { title: true, slug: true } },
      variants: true,
    },
  },
  license: {
    include: {
      delivery_tokens: { orderBy: { created_at: 'desc' as const }, take: 1 },
    },
  },
};

/**
 * Solicitudes de licencia sobre fotos publicadas. Fase 12a (captura + aviso) +
 * 12b (cotizar) + 12c (emitir la licencia y entregar el archivo original
 * limpio por un enlace de un solo uso).
 */
@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly site: SiteService,
    private readonly storage: StorageService,
    private readonly metadata: RightsMetadataService,
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
      include: REQUEST_INCLUDE,
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
      include: REQUEST_INCLUDE,
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

  /**
   * Acepta una solicitud ya cotizada: emite la licencia, genera el enlace de
   * entrega de un solo uso y avisa por correo al licenciatario. Quien
   * "acepta" aquí es el gestor — confirma que el cliente aceptó los términos
   * por el canal que hayan usado (correo, llamada) y lo marca en el panel;
   * este proyecto no construye un portal de autoservicio para el cliente.
   *
   * @throws NotFoundException si la solicitud no existe.
   * @throws BadRequestException si la solicitud no está cotizada — hace
   *         falta un precio acordado antes de poder aceptarla.
   */
  async accept(requestId: string): Promise<LicenseRequestView> {
    const request = await this.prisma.license_requests.findUnique({
      where: { request_id: requestId },
      include: { image: { include: { album: { select: { title: true, slug: true } } } } },
    });
    if (!request) {
      throw new NotFoundException('Solicitud no encontrada.');
    }
    if (request.status !== 'quoted') {
      throw new BadRequestException(
        'Solo se puede aceptar una solicitud que ya tenga una cotización.',
      );
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + DELIVERY_TOKEN_TTL_DAYS * 86_400_000);

    await this.prisma.$transaction(async (tx) => {
      const license = await tx.licenses.create({
        data: {
          request_id: request.request_id,
          image_id: request.image_id,
          licensee_name: request.requester_name,
          licensee_email: request.requester_email,
          intended_use: request.intended_use,
          price: request.quoted_price,
          conditions: request.quoted_conditions,
        },
      });
      await tx.delivery_tokens.create({
        data: {
          license_id: license.license_id,
          token_hash: sha256Hex(rawToken),
          expires_at: expiresAt,
        },
      });
      await tx.license_requests.update({
        where: { request_id: requestId },
        data: { status: 'accepted' },
      });
    });

    const backend = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');
    const downloadUrl = `${backend}/deliveries/${rawToken}`;

    await this.mail.send(
      request.requester_email,
      `Tu licencia está lista — ${escapeHtml(request.image.album.title)}`,
      `<p>Hola ${escapeHtml(request.requester_name)},</p>` +
        `<p>Tu licencia para una foto de «${escapeHtml(request.image.album.title)}» quedó emitida. ` +
        `Puedes descargar el archivo en alta resolución aquí:</p>` +
        `<p><a href="${downloadUrl}">${downloadUrl}</a></p>` +
        `<p>El enlace funciona <strong>una sola vez</strong> y caduca en ${DELIVERY_TOKEN_TTL_DAYS} días.</p>`,
    );

    const updated = await this.prisma.license_requests.findUniqueOrThrow({
      where: { request_id: requestId },
      include: REQUEST_INCLUDE,
    });
    return this.toView(updated);
  }

  /**
   * Consume un enlace de entrega: valida el token, lo marca usado de forma
   * **atómica** (para que dos descargas simultáneas del mismo enlace no
   * sirvan ambas el archivo) y devuelve el original limpio — con los
   * metadatos de derechos **y** una nota de a quién se licenció, incrustados
   * al vuelo para esta descarga (si el archivo se filtra después, queda
   * quién lo recibió).
   *
   * @param rawToken - El token tal como llega en la URL (`/deliveries/:token`).
   * @returns El stream del archivo + su nombre de descarga sugerido.
   * @throws NotFoundException si el token no existe, ya se usó, caducó, o el
   *         objeto ya no está en el almacenamiento — siempre el mismo error,
   *         nunca se revela cuál de esos fue (mismo principio que las URLs
   *         firmadas de `/media/:key`).
   */
  async consumeDelivery(
    rawToken: string,
  ): Promise<{ stream: NodeJS.ReadableStream; contentType: string; bytes: number; filename: string }> {
    const tokenHash = sha256Hex(rawToken);
    const token = await this.prisma.delivery_tokens.findUnique({
      where: { token_hash: tokenHash },
      include: {
        license: {
          include: {
            image: true,
          },
        },
      },
    });
    if (!token || token.used_at || token.expires_at.getTime() < Date.now()) {
      throw new NotFoundException();
    }

    // Consumo atómico: si dos peticiones llegan a la vez con el mismo token,
    // solo una gana la actualización (`count === 1`); la otra ve el token ya
    // usado y falla, en vez de que ambas reciban el archivo.
    const claim = await this.prisma.delivery_tokens.updateMany({
      where: { delivery_token_id: token.delivery_token_id, used_at: null },
      data: { used_at: new Date() },
    });
    if (claim.count !== 1) {
      throw new NotFoundException();
    }

    const image = token.license.image;
    const object = await this.storage.read(image.storage_key);
    if (!object) {
      throw new NotFoundException();
    }

    const rightsDefaults = await this.site.getRightsDefaults();
    const baseRights = resolveRights(rightsDefaults, image.rights);
    const licenseeNote =
      `Licencia otorgada a ${token.license.licensee_name} <${token.license.licensee_email}> ` +
      `para uso ${token.license.intended_use}` +
      (token.license.conditions ? `: ${token.license.conditions}` : '') +
      '.';
    const buffer = await streamToBuffer(object.stream);
    const format: EmbeddableFormat = image.mime_type === 'image/png' ? 'png' : 'jpeg';
    const withLicenseeInfo = await this.metadata.embed(buffer, format, {
      ...baseRights,
      rightsStatement: `${baseRights.rightsStatement} ${licenseeNote}`.trim(),
    });

    await this.prisma.license_requests.updateMany({
      where: { request_id: token.license.request_id },
      data: { status: 'fulfilled' },
    });

    const ext = format === 'png' ? 'png' : 'jpg';
    return {
      stream: bufferToStream(withLicenseeInfo),
      contentType: object.contentType,
      bytes: withLicenseeInfo.byteLength,
      filename: `licencia-${token.license.license_id.slice(0, 8)}.${ext}`,
    };
  }

  /** Proyecta una fila (con sus relaciones ya incluidas) a la forma del panel. */
  private toView(row: RequestRow): LicenseRequestView {
    const thumb = row.image.variants.find((v) => v.label === 'thumb');
    const delivery = row.license?.delivery_tokens[0] ?? null;
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
      license:
        row.license && delivery
          ? {
              licenseId: row.license.license_id,
              issuedAt: row.license.issued_at,
              deliveryStatus: delivery.used_at
                ? 'used'
                : delivery.expires_at.getTime() < Date.now()
                  ? 'expired'
                  : 'pending',
              deliveryExpiresAt: delivery.expires_at,
            }
          : null,
    };
  }
}

/** Envuelve un buffer ya en memoria como stream — lo que espera el controller de entrega. */
function bufferToStream(buffer: Buffer): NodeJS.ReadableStream {
  return Readable.from(buffer);
}
