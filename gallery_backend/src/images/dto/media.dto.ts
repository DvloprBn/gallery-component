import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Estados de curación de una imagen. */
export const MEDIA_STATUSES = ['archived', 'draft', 'published'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** `PATCH /images/:id` — metadatos editables de una imagen. */
export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Estado de curación: `archived` / `draft` / `published`. */
  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: MediaStatus;

  /**
   * Registro de derechos de ESTA imagen (Fase 11, D10) — solo los campos que
   * se quieran sobreescribir sobre los de `site_settings`; se sanea a la
   * lista de claves conocidas en el service (`sanitizeRightsPartial`), nunca
   * se guarda el objeto crudo. `null` limpia el override (vuelve a heredar
   * todo del sitio).
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  rights?: Record<string, unknown> | null;
}

/** `POST /albums/:id/media/reorder` — el orden nuevo, como lista de IDs. */
export class ReorderMediaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}

/** `POST /albums/:id/media/status` — cambia el estado de varios elementos de golpe. */
export class BulkStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  mediaIds!: string[];

  @IsIn(MEDIA_STATUSES)
  status!: MediaStatus;
}
