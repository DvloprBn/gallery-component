import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Visibilidades válidas de un álbum. */
export const ALBUM_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
/** Layouts válidos de un álbum. */
export const ALBUM_LAYOUTS = ['masonry', 'justified', 'grid', 'carousel'] as const;

/** `POST /albums` — todo se configura al crear, no "crear y luego editar". */
export class CreateAlbumDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(ALBUM_VISIBILITIES)
  visibility?: (typeof ALBUM_VISIBILITIES)[number];

  @IsOptional()
  @IsIn(ALBUM_LAYOUTS)
  layout?: (typeof ALBUM_LAYOUTS)[number];

  /** Tokens de diseño. Se valida forma y tamaño en el service (no CSS libre). */
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;
}

/** `PATCH /albums/:id`. */
export class UpdateAlbumDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(ALBUM_VISIBILITIES)
  visibility?: (typeof ALBUM_VISIBILITIES)[number];

  @IsOptional()
  @IsIn(ALBUM_LAYOUTS)
  layout?: (typeof ALBUM_LAYOUTS)[number];

  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  coverImageId?: string;
}

/** `POST /albums/:id/share-tokens`. */
export class CreateShareTokenDto {
  /** Minutos de validez del enlace. Omitir = sin caducidad. */
  @IsOptional()
  @IsInt()
  @Min(5)
  expiresInMinutes?: number;
}
