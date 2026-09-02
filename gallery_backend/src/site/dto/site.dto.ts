import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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
}
