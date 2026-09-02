import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** `POST /contact` — mensaje del formulario público. */
export class SubmitContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;

  /**
   * Trampa anti-bot ("honeypot"): un campo oculto para humanos. Si llega con
   * valor, la petición se acepta con 202 pero se descarta en silencio.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** `PATCH /contact/messages/:id`. */
export class MarkMessageDto {
  @IsBoolean()
  read!: boolean;
}
