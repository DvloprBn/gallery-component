import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Patrones válidos de marca de agua. */
export const WATERMARK_PLACEMENTS = ['tiled', 'corner'] as const;

/** `PATCH /site` — ajustes de identidad del sitio. Todo opcional (se hace merge). */
export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  siteTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  aboutBody?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  contactIntro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  instagram?: string;

  /** UUID de una imagen (de un álbum público) para el hero de la portada, o `null` para quitarlo. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  heroImageId?: string | null;

  // ── Marca de agua (Fase 11, D9) ──

  /** Texto de respaldo si no hay logo subido (la subida va por `POST /site/watermark`). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  watermarkText?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(0.9)
  watermarkOpacity?: number;

  @IsOptional()
  @IsIn(WATERMARK_PLACEMENTS)
  watermarkPlacement?: (typeof WATERMARK_PLACEMENTS)[number];

  // ── Derechos por defecto (Fase 11, D10) ──

  @IsOptional()
  @IsString()
  @MaxLength(160)
  rightsHolder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  creator?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  creditLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  rightsStatement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  defaultLicenseTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  licensorUrl?: string;
}
