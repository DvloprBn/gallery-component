import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `POST /roles` — crea un rol dinámico. */
export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'El nombre debe ser minúsculas, dígitos y guiones bajos.',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Nivel de autoridad. Debe ser estrictamente menor al del actor. */
  @IsInt()
  @Min(0)
  @Max(100)
  level!: number;

  /** Cupo de cuentas activas con este rol. Omitir = sin límite. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount?: number;
}

/** `PATCH /roles/:id` — edita un rol. `name` no se cambia por esta vía. */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  level?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount?: number;
}
