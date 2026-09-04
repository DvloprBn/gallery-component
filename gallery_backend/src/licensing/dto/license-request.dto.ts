import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Los usos que se pueden solicitar — coincide con D11 (`PLAN_DESARROLLO.md` §4). */
export const INTENDED_USES = ['editorial', 'commercial', 'social', 'print'] as const;
export type IntendedUse = (typeof INTENDED_USES)[number];

/** `POST /license-requests` — solicitud pública de licencia sobre una foto. */
export class SubmitLicenseRequestDto {
  @IsUUID()
  imageId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsIn(INTENDED_USES)
  intendedUse!: IntendedUse;

  /** Descripción del uso previsto / alcance. */
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;

  /** Presupuesto — texto libre, opcional (no se fuerza moneda ni monto). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  budget?: string;

  /**
   * Trampa anti-bot ("honeypot"): un campo oculto para humanos. Si llega con
   * valor, la petición se acepta con 202 pero se descarta en silencio — mismo
   * patrón que `SubmitContactDto`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
