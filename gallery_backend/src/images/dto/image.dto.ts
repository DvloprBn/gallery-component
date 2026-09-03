import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Estados de curación de una imagen. */
export const IMAGE_STATUSES = ['archived', 'draft', 'published'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

/** `PATCH /images/:id` — metadatos editables de una imagen. */
export class UpdateImageDto {
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
  @IsIn(IMAGE_STATUSES)
  status?: ImageStatus;
}

/** `POST /albums/:id/images/reorder` — el orden nuevo, como lista de IDs. */
export class ReorderImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}

/** `POST /albums/:id/images/status` — cambia el estado de varias imágenes de golpe. */
export class BulkStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  imageIds!: string[];

  @IsIn(IMAGE_STATUSES)
  status!: ImageStatus;
}
