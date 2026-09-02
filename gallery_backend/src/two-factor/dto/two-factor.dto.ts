import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** Un código TOTP: exactamente 6 dígitos. */
export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código son 6 dígitos.' })
  code!: string;
}

/** Desactivar 2FA: se exige la contraseña de la cuenta como confirmación. */
export class DisableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
