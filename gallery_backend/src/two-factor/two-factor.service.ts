import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../common/prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/utils/crypto.util';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotp,
} from '../common/utils/totp.util';

/** Cuántos códigos de recuperación se generan al activar 2FA. */
const RECOVERY_CODE_COUNT = 10;
/** Coste bcrypt para los códigos de recuperación (más bajo: son de un solo uso). */
const RECOVERY_BCRYPT_COST = 10;

/**
 * Activación y gestión del segundo factor (TOTP).
 *
 * El secreto TOTP se guarda **cifrado** (AES-256-GCM) — el servidor necesita
 * poder leerlo para verificar el código. Los códigos de recuperación se
 * guardan **hasheados** (bcrypt) porque solo se comparan, nunca se re-muestran.
 */
@Injectable()
export class TwoFactorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Empieza la activación: genera y guarda (cifrado) un secreto nuevo, todavía
   * SIN activar 2FA, y devuelve el QR para escanear.
   *
   * @param userId - Cuenta que activa 2FA.
   * @returns El secreto en base32, la URI `otpauth://` y el QR como data URL.
   * @throws ConflictException si 2FA ya está activo.
   */
  async setup(userId: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
    });
    if (user.totp_enabled) {
      throw new ConflictException('El 2FA ya está activo en esta cuenta.');
    }

    const secret = generateTotpSecret();
    await this.prisma.users.update({
      where: { user_id: userId },
      data: { totp_secret_encrypted: encryptSecret(secret), totp_enabled: false },
    });

    const otpauthUrl = buildOtpAuthUrl(secret, user.email, 'Galería');
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  /**
   * Confirma la activación con el primer código real. Activa 2FA y entrega los
   * códigos de recuperación **una sola vez**.
   *
   * @param userId - Cuenta.
   * @param code - Código TOTP de 6 dígitos.
   * @returns Los códigos de recuperación en claro (no se vuelven a mostrar).
   * @throws BadRequestException si no se llamó antes a `setup`.
   * @throws ConflictException si 2FA ya estaba activo.
   * @throws UnauthorizedException si el código es incorrecto.
   */
  async confirmSetup(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
    });
    if (user.totp_enabled) {
      throw new ConflictException('El 2FA ya está activo.');
    }
    if (!user.totp_secret_encrypted) {
      throw new BadRequestException('Primero inicia la activación con /two-factor/setup.');
    }
    if (!verifyTotp(code, decryptSecret(user.totp_secret_encrypted))) {
      throw new UnauthorizedException('Código incorrecto.');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5).toString('hex'),
    );
    const hashes = await Promise.all(
      codes.map((c) => bcrypt.hash(c, RECOVERY_BCRYPT_COST)),
    );

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: userId },
        data: { totp_enabled: true },
      }),
      this.prisma.totp_recovery_codes.deleteMany({ where: { user_id: userId } }),
      ...hashes.map((code_hash) =>
        this.prisma.totp_recovery_codes.create({
          data: { user_id: userId, code_hash },
        }),
      ),
    ]);

    return { recoveryCodes: codes };
  }

  /**
   * Desactiva 2FA. Exige la contraseña de la cuenta como confirmación.
   *
   * @param userId - Cuenta.
   * @param password - Contraseña actual.
   * @throws ConflictException si 2FA no estaba activo.
   * @throws UnauthorizedException si la contraseña no coincide.
   */
  async disable(userId: string, password: string): Promise<{ ok: true }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
    });
    if (!user.totp_enabled) {
      throw new ConflictException('El 2FA no está activo.');
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: userId },
        data: { totp_enabled: false, totp_secret_encrypted: null },
      }),
      this.prisma.totp_recovery_codes.deleteMany({ where: { user_id: userId } }),
    ]);
    return { ok: true };
  }

  /**
   * Regenera los 10 códigos de recuperación (invalida los anteriores). Exige
   * un código TOTP válido.
   *
   * @param userId - Cuenta.
   * @param code - Código TOTP de 6 dígitos.
   * @returns Los códigos nuevos, en claro.
   * @throws ConflictException si 2FA no está activo.
   * @throws UnauthorizedException si el código es incorrecto.
   */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
    });
    if (!user.totp_enabled || !user.totp_secret_encrypted) {
      throw new ConflictException('El 2FA no está activo.');
    }
    if (!verifyTotp(code, decryptSecret(user.totp_secret_encrypted))) {
      throw new UnauthorizedException('Código incorrecto.');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5).toString('hex'),
    );
    const hashes = await Promise.all(
      codes.map((c) => bcrypt.hash(c, RECOVERY_BCRYPT_COST)),
    );

    await this.prisma.$transaction([
      this.prisma.totp_recovery_codes.deleteMany({ where: { user_id: userId } }),
      ...hashes.map((code_hash) =>
        this.prisma.totp_recovery_codes.create({
          data: { user_id: userId, code_hash },
        }),
      ),
    ]);
    return { recoveryCodes: codes };
  }
}
