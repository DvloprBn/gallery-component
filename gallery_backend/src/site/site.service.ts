import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
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
}

/** Fila única de `site_settings` (id = 1). */
const SETTINGS_ID = 1;

/**
 * Identidad del sitio (portafolio): nombre, declaración, "sobre mí", contacto,
 * imagen del hero. Una sola fila — se crea al primer acceso si no existe.
 */
@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
    };

    const settings = await this.prisma.site_settings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    return this.toPublic(settings);
  }

  /** Proyecta la fila a la forma pública, resolviendo las URLs del hero. */
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
    };
  }
}
