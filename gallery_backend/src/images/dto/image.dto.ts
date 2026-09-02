import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

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
}

/** `POST /albums/:id/images/reorder` — el orden nuevo, como lista de IDs. */
export class ReorderImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
