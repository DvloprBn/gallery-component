import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { streamToBuffer } from '../common/utils/stream.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { ImagePipelineService } from '../media-processing/image-pipeline.service';
import type { EmbeddableFormat, RightsFields } from '../protection/rights-metadata.service';
import { RightsMetadataService } from '../protection/rights-metadata.service';
import { resolveRights } from '../protection/rights.util';
import type { WatermarkConfig } from '../protection/watermark.service';
import { WatermarkService } from '../protection/watermark.service';
import { StorageService } from '../storage/storage.service';
import { UpdateSiteDto } from './dto/site.dto';

/** La imagen del hero, ya con sus URLs de entrega resueltas. */
export interface HeroImage {
  imageId: string;
  width: number;
  height: number;
  placeholder: string | null;
  urls: Record<string, string>;
}

/** Configuración de marca de agua tal como la ve el gestor. */
export interface PublicWatermark {
  hasAsset: boolean;
  previewUrl: string | null;
  text: string;
  opacity: number;
  placement: 'tiled' | 'corner';
}

/** Registro de derechos por defecto tal como lo ve el gestor. */
export interface PublicRights extends RightsFields {
  /** El aviso ya resuelto (con fallback), listo para mostrar en pie/lightbox. */
  noticeText: string;
}

/** Lo que necesita `runRegeneration` de cada imagen — evita depender del tipo inferido de Prisma. */
interface RegenerableImage {
  image_id: string;
  storage_key: string;
  mime_type: string;
  rights: unknown;
  variants: { variant_id: string; label: string; storage_key: string }[];
}

/** Progreso de la regeneración de marca de agua / derechos en segundo plano. */
export interface RegenerationStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  processed: number;
  skipped: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** Ajustes públicos del sitio. */
export interface PublicSite {
  siteTitle: string;
  ownerName: string;
  tagline: string;
  bio: string;
  aboutBody: string;
  contactEmail: string;
  contactIntro: string;
  instagram: string;
  hero: HeroImage | null;
  watermark: PublicWatermark;
  rights: PublicRights;
}

/** Fila única de `site_settings` (id = 1). */
const SETTINGS_ID = 1;

/** Tope de subida del logo de marca de agua (bytes) — no es una foto, no hace falta más. */
const MAX_WATERMARK_BYTES = 5 * 1024 * 1024;
/** Tope de píxeles de entrada del logo — misma defensa que el pipeline de fotos. */
const MAX_WATERMARK_PIXELS = 20_000_000;

/**
 * Identidad del sitio (portafolio): nombre, declaración, "sobre mí", contacto,
 * imagen del hero, **marca de agua** y **derechos por defecto** (Fase 11).
 * Una sola fila — se crea al primer acceso si no existe.
 */
@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  /** Estado de la regeneración en curso/última — en memoria, ver `startWatermarkRegeneration`. */
  private regenState: RegenerationStatus = {
    status: 'idle',
    processed: 0,
    skipped: 0,
    total: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly watermark: WatermarkService,
    private readonly metadata: RightsMetadataService,
    private readonly pipeline: ImagePipelineService,
  ) {}

  /** Devuelve los ajustes públicos, creando la fila por defecto si no existe. */
  async get(): Promise<PublicSite> {
    const settings = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    return this.toPublic(settings);
  }

  /**
   * Actualiza los ajustes (merge de los campos presentes en el DTO).
   *
   * @throws BadRequestException si `heroImageId` apunta a una imagen que no
   *         existe o cuyo álbum no es público (el hero se sirve sin firma en
   *         una página cacheada).
   */
  async update(dto: UpdateSiteDto): Promise<PublicSite> {
    if (dto.heroImageId) {
      const image = await this.prisma.images.findUnique({
        where: { image_id: dto.heroImageId },
        include: { album: { select: { visibility: true } } },
      });
      if (
        !image ||
        image.album.visibility !== 'public' ||
        image.status !== 'published'
      ) {
        throw new BadRequestException(
          'La imagen del hero debe ser una foto publicada de una colección pública.',
        );
      }
    }

    const data = {
      ...(dto.siteTitle !== undefined ? { site_title: dto.siteTitle } : {}),
      ...(dto.ownerName !== undefined ? { owner_name: dto.ownerName } : {}),
      ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
      ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      ...(dto.aboutBody !== undefined ? { about_body: dto.aboutBody } : {}),
      ...(dto.contactEmail !== undefined
        ? { contact_email: dto.contactEmail }
        : {}),
      ...(dto.contactIntro !== undefined
        ? { contact_intro: dto.contactIntro }
        : {}),
      ...(dto.instagram !== undefined ? { instagram: dto.instagram } : {}),
      ...(dto.heroImageId !== undefined
        ? { hero_image_id: dto.heroImageId }
        : {}),
      ...(dto.watermarkText !== undefined
        ? { watermark_text: dto.watermarkText }
        : {}),
      ...(dto.watermarkOpacity !== undefined
        ? { watermark_opacity: dto.watermarkOpacity }
        : {}),
      ...(dto.watermarkPlacement !== undefined
        ? { watermark_placement: dto.watermarkPlacement }
        : {}),
      ...(dto.rightsHolder !== undefined
        ? { rights_holder: dto.rightsHolder }
        : {}),
      ...(dto.creator !== undefined ? { creator: dto.creator } : {}),
      ...(dto.creditLine !== undefined ? { credit_line: dto.creditLine } : {}),
      ...(dto.rightsStatement !== undefined
        ? { rights_statement: dto.rightsStatement }
        : {}),
      ...(dto.defaultLicenseTerms !== undefined
        ? { default_license_terms: dto.defaultLicenseTerms }
        : {}),
      ...(dto.licensorUrl !== undefined
        ? { licensor_url: dto.licensorUrl }
        : {}),
    };

    const settings = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    return this.toPublic(settings);
  }

  /**
   * Sube (o reemplaza) el logo de marca de agua.
   *
   * @param file - El archivo subido (multipart, campo `file`).
   * @returns Los ajustes con el nuevo `watermark.previewUrl`.
   * @throws BadRequestException si el contenido no es una imagen decodificable.
   */
  async uploadWatermarkAsset(file: {
    buffer: Buffer;
    size: number;
  }): Promise<PublicSite> {
    if (file.size > MAX_WATERMARK_BYTES) {
      throw new BadRequestException('El logo no puede pesar más de 5 MB.');
    }

    // Mismo principio que el pipeline de fotos: sharp decide si es una
    // imagen real, nunca la extensión ni el Content-Type del cliente.
    let normalized: Buffer;
    try {
      normalized = await sharpNormalizeLogo(file.buffer);
    } catch {
      throw new BadRequestException('El archivo no es una imagen válida.');
    }

    const stored = await this.storage.put(normalized, {
      extension: 'png',
      contentType: 'image/png',
      visibility: 'public',
    });

    const current = await this.prisma.site_settings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (current?.watermark_asset_key) {
      await this.storage.remove(current.watermark_asset_key).catch(() => undefined);
    }

    const settings = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: { watermark_asset_key: stored.key },
      create: { id: SETTINGS_ID, watermark_asset_key: stored.key },
    });
    return this.toPublic(settings);
  }

  /** Quita el logo subido — la marca vuelve a usar el texto de respaldo. */
  async removeWatermarkAsset(): Promise<PublicSite> {
    const current = await this.prisma.site_settings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (current?.watermark_asset_key) {
      await this.storage.remove(current.watermark_asset_key).catch(() => undefined);
    }
    const settings = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: { watermark_asset_key: '' },
      create: { id: SETTINGS_ID },
    });
    return this.toPublic(settings);
  }

  /**
   * Arranca la regeneración de todas las colecciones públicas **en segundo
   * plano** y devuelve de inmediato — con ~80 imágenes × 5 archivos (original
   * + 4 derivados), cada uno pasando por `sharp` y un proceso `exiftool`
   * aparte, la regeneración completa tarda varios minutos: hacerla síncrona
   * agota el tiempo de espera de cualquier cliente HTTP (verificado: con las
   * ~80 imágenes de la demo, una llamada síncrona superó los 5 minutos y el
   * cliente cortó la conexión antes de que terminara).
   *
   * El estado vive **en memoria del proceso** (no en Redis — aquí Redis es
   * solo para rate limiting/fuerza bruta, nunca datos de negocio ni de
   * estado de trabajos, ver `RedisService`). Es aceptable: un solo proceso
   * backend, y perder el progreso en un reinicio a mitad de una regeneración
   * no es grave — se puede volver a lanzar.
   *
   * @returns El estado inicial (`running`), o el estado actual si ya había
   *          una regeneración en curso (no se lanzan dos a la vez).
   */
  startWatermarkRegeneration(): RegenerationStatus {
    if (this.regenState.status === 'running') {
      return { ...this.regenState };
    }
    this.regenState = {
      status: 'running',
      processed: 0,
      skipped: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    // Fire-and-forget deliberado: el llamador (HTTP) no espera esta promesa;
    // el progreso se consulta con `getWatermarkRegenerationStatus()`.
    void this.runRegeneration();
    return { ...this.regenState };
  }

  /** El estado (y progreso) de la última regeneración lanzada. */
  getWatermarkRegenerationStatus(): RegenerationStatus {
    return { ...this.regenState };
  }

  /** El trabajo real de regeneración — nunca se llama directo, solo desde `startWatermarkRegeneration`. */
  private async runRegeneration(): Promise<void> {
    let images: RegenerableImage[] = [];
    try {
      images = await this.prisma.images.findMany({
        where: { album: { visibility: 'public' } },
        include: { variants: true },
      });
    } catch (error) {
      this.regenState = {
        ...this.regenState,
        status: 'error',
        error: (error as Error).message,
        finishedAt: new Date().toISOString(),
      };
      return;
    }

    this.regenState.total = images.length;
    const watermarkConfig = await this.getWatermarkConfig();
    const rightsDefaults = await this.getRightsDefaults();

    for (const image of images) {
      try {
        // `storage.read` solo lo implementa el driver de disco — con
        // Cloudinary (producción) esta imagen se cuenta como "skipped": leer
        // de vuelta el original requeriría bajarlo por HTTPS de su CDN, que
        // no está implementado todavía (ver DOCUMENTO_VIVO_ARQUITECTURA §14).
        const object = await this.storage.read(image.storage_key);
        if (!object) {
          this.regenState.skipped++;
          continue;
        }
        const originalBuffer = await streamToBuffer(object.stream);
        const rights = resolveRights(rightsDefaults, image.rights);
        const originalFormat: EmbeddableFormat =
          image.mime_type === 'image/png' ? 'png' : 'jpeg';

        // Metadatos frescos en el original limpio (nunca lleva marca).
        const withMeta = await this.metadata.embed(
          originalBuffer,
          originalFormat,
          rights,
        );
        if (!withMeta.equals(originalBuffer)) {
          const stored = await this.storage.put(withMeta, {
            extension: originalFormat,
            contentType: image.mime_type,
            visibility: 'public',
          });
          await this.storage.remove(image.storage_key).catch(() => undefined);
          await this.prisma.images.update({
            where: { image_id: image.image_id },
            data: { storage_key: stored.key },
          });
        }

        for (const variant of image.variants) {
          const rebuilt = await this.pipeline.buildVariant(
            originalBuffer,
            variant.label,
          );
          const marked = await this.watermark.composite(
            rebuilt.buffer,
            watermarkConfig,
          );
          const withRights = await this.metadata.embed(marked, 'webp', rights);
          const stored = await this.storage.put(withRights, {
            extension: 'webp',
            contentType: 'image/webp',
            visibility: 'public',
          });
          await this.storage.remove(variant.storage_key).catch(() => undefined);
          await this.prisma.image_variants.update({
            where: { variant_id: variant.variant_id },
            data: { storage_key: stored.key, bytes: stored.bytes },
          });
        }
        this.regenState.processed++;
      } catch (error) {
        this.logger.warn(
          `No se pudo regenerar la imagen ${image.image_id}: ${(error as Error).message}`,
        );
        this.regenState.skipped++;
      }
    }

    this.regenState = {
      ...this.regenState,
      status: 'done',
      finishedAt: new Date().toISOString(),
    };
  }

  /**
   * La configuración de marca de agua, resuelta y lista para
   * `WatermarkService.composite()` (logo decodificado si hay uno subido).
   */
  async getWatermarkConfig(): Promise<WatermarkConfig> {
    const row = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });

    let assetBuffer: Buffer | null = null;
    if (row.watermark_asset_key) {
      const object = await this.storage.read(row.watermark_asset_key);
      if (object) {
        assetBuffer = await streamToBuffer(object.stream);
      } else {
        this.logger.warn(
          'watermark_asset_key configurada pero no se pudo releer (¿driver Cloudinary?) — se usa el texto de respaldo.',
        );
      }
    }

    return {
      assetBuffer,
      text: this.resolveWatermarkText(row.watermark_text, row.owner_name),
      opacity: row.watermark_opacity,
      placement: row.watermark_placement === 'corner' ? 'corner' : 'tiled',
    };
  }

  /** Los derechos por defecto del sitio, con el aviso ya calculado si está vacío. */
  async getRightsDefaults(): Promise<RightsFields> {
    const row = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    const holder = row.rights_holder || row.owner_name || row.site_title;
    return {
      rightsHolder: holder,
      creator: row.creator || row.owner_name,
      creditLine: row.credit_line,
      rightsStatement: row.rights_statement || this.defaultNotice(holder),
      licenseTerms: row.default_license_terms,
      licensorUrl: row.licensor_url,
    };
  }

  /** Texto de respaldo de la marca de agua — nunca vacío. */
  private resolveWatermarkText(text: string, ownerName: string): string {
    if (text) return text;
    if (ownerName) return `© ${ownerName}`;
    return '© Todos los derechos reservados';
  }

  /** Aviso de derechos calculado cuando no se escribió uno explícito. */
  private defaultNotice(holder: string): string {
    if (!holder) return '';
    return `© ${holder} ${new Date().getFullYear()}. Todos los derechos reservados.`;
  }

  /** Proyecta la fila a la forma pública, resolviendo las URLs del hero y la marca. */
  private async toPublic(settings: {
    site_title: string;
    owner_name: string;
    tagline: string;
    bio: string;
    about_body: string;
    contact_email: string;
    contact_intro: string;
    instagram: string;
    hero_image_id: string | null;
    watermark_asset_key: string;
    watermark_text: string;
    watermark_opacity: number;
    watermark_placement: string;
    rights_holder: string;
    creator: string;
    credit_line: string;
    rights_statement: string;
    default_license_terms: string;
    licensor_url: string;
  }): Promise<PublicSite> {
    let hero: HeroImage | null = null;
    if (settings.hero_image_id) {
      // Solo se sirve como hero si sigue publicada (pudo archivarse después
      // de fijarla); si no, la portada cae a su degradado.
      const image = await this.prisma.images.findFirst({
        where: { image_id: settings.hero_image_id, status: 'published' },
        include: { variants: true },
      });
      if (image) {
        hero = {
          imageId: image.image_id,
          width: image.width,
          height: image.height,
          placeholder: image.placeholder,
          urls: {
            original: this.storage.urlFor(image.storage_key, 'public'),
            ...Object.fromEntries(
              image.variants.map((v) => [
                v.label,
                this.storage.urlFor(v.storage_key, 'public'),
              ]),
            ),
          },
        };
      }
    }

    const holder =
      settings.rights_holder || settings.owner_name || settings.site_title;

    return {
      siteTitle: settings.site_title,
      ownerName: settings.owner_name,
      tagline: settings.tagline,
      bio: settings.bio,
      aboutBody: settings.about_body,
      contactEmail: settings.contact_email,
      contactIntro: settings.contact_intro,
      instagram: settings.instagram,
      hero,
      watermark: {
        hasAsset: Boolean(settings.watermark_asset_key),
        previewUrl: settings.watermark_asset_key
          ? this.storage.urlFor(settings.watermark_asset_key, 'public')
          : null,
        text: this.resolveWatermarkText(
          settings.watermark_text,
          settings.owner_name,
        ),
        opacity: settings.watermark_opacity,
        placement: settings.watermark_placement === 'corner' ? 'corner' : 'tiled',
      },
      rights: {
        rightsHolder: holder,
        creator: settings.creator || settings.owner_name,
        creditLine: settings.credit_line,
        rightsStatement: settings.rights_statement || this.defaultNotice(holder),
        licenseTerms: settings.default_license_terms,
        licensorUrl: settings.licensor_url,
        noticeText: settings.rights_statement || this.defaultNotice(holder),
      },
    };
  }
}

/**
 * Decodifica y re-normaliza el logo de marca de agua: si no es una imagen
 * real, `sharp` lanza y la subida se rechaza antes de guardar nada. Se
 * re-codifica a PNG (mismo principio que las fotos: nunca se guarda el
 * archivo crudo del cliente) y se acota a 1000×1000 — es un logo, no una foto.
 */
async function sharpNormalizeLogo(buffer: Buffer): Promise<Buffer> {
  const probe = sharp(buffer, { limitInputPixels: MAX_WATERMARK_PIXELS });
  const meta = await probe.metadata();
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) {
    throw new Error('formato no soportado');
  }
  return sharp(buffer, { limitInputPixels: MAX_WATERMARK_PIXELS })
    .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
