import {
  IsDateString,
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
  mediaId!: string;

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

/** `PATCH /license-requests/:id` — el gestor cotiza una solicitud (Fase 12b). */
export class QuoteLicenseRequestDto {
  /** Precio — texto libre, igual que `budget` (no se fuerza moneda ni monto). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  price!: string;

  /** Condiciones/alcance de la licencia ofrecida (uso, vigencia, exclusividad…), en prosa. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditions?: string;

  /** Hasta cuándo es válida ESTA cotización (no la licencia una vez aceptada). */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
