import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Reglas de contraseña, en un solo lugar. No es exhaustivo (no bloquea
 * contraseñas filtradas), pero sí impone longitud y variedad mínimas.
 */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
const PASSWORD_RULE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/; // al menos una minúscula, una mayúscula y un dígito

/** `POST /auth/register` — alta pública. */
export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(PASSWORD_RULE, {
    message:
      'La contraseña necesita al menos una minúscula, una mayúscula y un dígito.',
  })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;
}

/** `POST /auth/login/step1` — solo el correo (UX estilo Google). */
export class LoginStep1Dto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

/** `POST /auth/login/step2` — correo + contraseña. */
export class LoginStep2Dto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

/** `POST /auth/login/2fa` — el challenge token + el código de 6 dígitos o uno de recuperación. */
export class Login2faDto {
  @IsString()
  @IsNotEmpty()
  challenge!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

/** `PATCH /auth/me/password` — cambio de contraseña con la sesión abierta. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(PASSWORD_RULE, {
    message:
      'La contraseña necesita al menos una minúscula, una mayúscula y un dígito.',
  })
  newPassword!: string;
}

/** `POST /auth/forgot-password`. */
export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

/** `POST /auth/reset-password`. */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(PASSWORD_RULE, {
    message:
      'La contraseña necesita al menos una minúscula, una mayúscula y un dígito.',
  })
  newPassword!: string;
}
