import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  durationToMs,
  durationToSeconds,
} from '../common/utils/duration.util';
import { escapeHtml } from '../common/utils/escape-html.util';
import {
  generateOpaqueToken,
  sha256Hex,
} from '../common/utils/token.util';
import { verifyTotp } from '../common/utils/totp.util';
import { decryptSecret } from '../common/utils/crypto.util';
import { MailService } from '../mail/mail.service';
import { SecurityEventsService } from '../security-events/security-events.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  Login2faDto,
  LoginStep2Dto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { clearAuthCookies, setAuthCookies } from './cookies';
import type { AuthenticatedUser, JwtPayload } from './jwt-payload.interface';

/** Contexto de la petición que se registra con cada intento. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/** Coste de bcrypt para contraseñas y códigos de recuperación. */
const BCRYPT_COST = 12;
/** Ventana de gracia para el reuso de un refresh token en carrera (ms). */
const REFRESH_GRACE_MS = 10_000;
/** Vigencia de un token de restablecer contraseña. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/**
 * Hash bcrypt de una contraseña que no le pertenece a nadie. Se compara
 * contra él cuando el correo no existe, para que el login tarde lo mismo
 * exista o no la cuenta (anti-enumeración por tiempo de respuesta).
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-that-nobody-uses', BCRYPT_COST);

/**
 * Toda la lógica de identidad: registro, login en 3 pasos (correo →
 * contraseña → 2FA), rotación de sesión, logout, cambio y recuperación de
 * contraseña.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly security: SecurityEventsService,
    private readonly mail: MailService,
  ) {}

  // ─────────────────────────── Registro ───────────────────────────

  /**
   * Alta pública. Crea la cuenta con el rol de nivel más bajo y deja la
   * sesión iniciada.
   *
   * @param dto - Correo, contraseña y nombre.
   * @param ctx - IP / User-Agent de la petición.
   * @param res - Respuesta (para fijar las cookies de sesión).
   * @returns Datos mínimos de la cuenta creada.
   * @throws ConflictException si el correo ya está registrado.
   */
  async register(
    dto: RegisterDto,
    ctx: RequestContext,
    res: Response,
  ): Promise<{ userId: string; email: string }> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.users.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Ese correo ya está registrado.');
    }

    const baseRole = await this.prisma.roles.findFirst({
      orderBy: { level: 'asc' },
    });
    if (!baseRole) {
      throw new Error('No hay roles sembrados — corre el seed.');
    }

    const user = await this.prisma.users.create({
      data: {
        email,
        password_hash: await bcrypt.hash(dto.password, BCRYPT_COST),
        name: dto.name.trim(),
        role_id: baseRole.role_id,
      },
    });

    await this.issueSession(user.user_id, ctx, res);
    return { userId: user.user_id, email: user.email };
  }

  // ───────────────────────── Login en 3 pasos ─────────────────────────

  /**
   * Paso 1: recibe solo el correo. Responde SIEMPRE lo mismo, exista o no la
   * cuenta — el frontend avanza a la pantalla de contraseña sin saber nada.
   *
   * @returns `{ next: 'password' }`, siempre.
   */
  loginStep1(): { next: 'password' } {
    return { next: 'password' };
  }

  /**
   * Paso 2: correo + contraseña.
   *
   * @param dto - Credenciales.
   * @param ctx - IP / User-Agent.
   * @param res - Respuesta (para las cookies, si el login se completa aquí).
   * @returns `{ next: 'done' }` con la sesión ya iniciada si la cuenta no
   *          tiene 2FA; `{ next: '2fa', challenge }` con un token de corta
   *          vida si sí la tiene (NUNCA emite sesión en ese caso).
   * @throws UnauthorizedException con mensaje genérico si las credenciales
   *         no son válidas o la cuenta está inactiva.
   * @throws HttpException 429 si se superó el umbral de fuerza bruta.
   */
  async loginStep2(
    dto: LoginStep2Dto,
    ctx: RequestContext,
    res: Response,
  ): Promise<
    { next: 'done'; user: AuthenticatedUser } | { next: '2fa'; challenge: string }
  > {
    const email = dto.email.toLowerCase().trim();
    await this.security.assertNotBlocked('login_bruteforce', email, ctx.ip);

    const user = await this.prisma.users.findUnique({
      where: { email },
      include: { roles: true },
    });

    // Comparar siempre contra ALGÚN hash: mismo tiempo exista o no la cuenta.
    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.password_hash ?? DUMMY_HASH,
    );

    if (!user || !user.is_active || !passwordOk) {
      await this.security.recordFailure(
        'login_bruteforce',
        email,
        ctx.ip,
        ctx.userAgent,
      );
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    await this.security.reset('login_bruteforce', email, ctx.ip);

    if (user.totp_enabled) {
      const challenge = this.jwt.sign(
        { sub: user.user_id, purpose: '2fa_challenge' } satisfies JwtPayload,
        { algorithm: 'HS256', expiresIn: 60 * 5 },
      );
      return { next: '2fa', challenge };
    }

    await this.issueSession(user.user_id, ctx, res);
    return {
      next: 'done',
      user: this.toAuthenticatedUser(user),
    };
  }

  /**
   * Paso 3: el challenge token del paso 2 + el código TOTP (o uno de
   * recuperación de un solo uso).
   *
   * @param dto - `challenge` + `code`.
   * @param ctx - IP / User-Agent.
   * @param res - Respuesta (para las cookies de sesión).
   * @returns `{ next: 'done' }` con la sesión iniciada.
   * @throws UnauthorizedException si el challenge no es válido/expiró o el
   *         código es incorrecto.
   * @throws HttpException 429 si se superó el umbral de fuerza bruta de 2FA.
   */
  async login2fa(
    dto: Login2faDto,
    ctx: RequestContext,
    res: Response,
  ): Promise<{ next: 'done'; user: AuthenticatedUser }> {
    let userId: string;
    try {
      const payload = this.jwt.verify<JwtPayload>(dto.challenge, {
        algorithms: ['HS256'],
      });
      if (payload.purpose !== '2fa_challenge') {
        throw new Error('propósito incorrecto');
      }
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('El paso de contraseña expiró. Vuelve a empezar.');
    }

    await this.security.assertNotBlocked('twofactor_bruteforce', userId, ctx.ip);

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      include: { roles: true },
    });
    if (!user || !user.is_active || !user.totp_enabled || !user.totp_secret_encrypted) {
      throw new UnauthorizedException('No se pudo completar el segundo factor.');
    }

    const codeOk =
      verifyTotp(dto.code, decryptSecret(user.totp_secret_encrypted)) ||
      (await this.consumeRecoveryCode(user.user_id, dto.code));

    if (!codeOk) {
      await this.security.recordFailure(
        'twofactor_bruteforce',
        userId,
        ctx.ip,
        ctx.userAgent,
      );
      throw new UnauthorizedException('Código incorrecto.');
    }

    await this.security.reset('twofactor_bruteforce', userId, ctx.ip);
    await this.issueSession(user.user_id, ctx, res);
    return { next: 'done', user: this.toAuthenticatedUser(user) };
  }

  // ─────────────────────────── Sesión ───────────────────────────

  /**
   * Rota el refresh token: invalida el presentado y emite un par nuevo.
   *
   * Si se presenta un token ya usado fuera de la ventana de gracia, asume
   * robo: **revoca todas las sesiones de la cuenta** y registra el evento.
   *
   * @param refreshRaw - El refresh token en claro (de la cookie).
   * @param ctx - IP / User-Agent.
   * @param res - Respuesta (para las cookies nuevas, o para borrarlas si se revoca).
   * @throws UnauthorizedException si el token falta, no existe, expiró, o se
   *         detecta reuso.
   */
  async refresh(
    refreshRaw: string | undefined,
    ctx: RequestContext,
    res: Response,
  ): Promise<{ ok: true }> {
    if (!refreshRaw) {
      throw new UnauthorizedException();
    }
    const tokenHash = sha256Hex(refreshRaw);
    const token = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: tokenHash },
    });
    if (!token) {
      throw new UnauthorizedException();
    }

    const now = Date.now();
    const usedAgoMs = token.used_at ? now - token.used_at.getTime() : Infinity;
    const isReuse = token.revoked || usedAgoMs > REFRESH_GRACE_MS;

    if ((token.revoked || token.used_at) && isReuse) {
      await this.prisma.refresh_tokens.updateMany({
        where: { user_id: token.user_id, revoked: false },
        data: { revoked: true },
      });
      await this.security.recordFailure(
        'refresh_token_reuse',
        token.user_id,
        ctx.ip,
        ctx.userAgent,
      );
      clearAuthCookies(res);
      throw new UnauthorizedException('Sesión revocada por seguridad.');
    }

    if (token.expires_at.getTime() < now) {
      throw new UnauthorizedException();
    }

    await this.prisma.refresh_tokens.update({
      where: { token_id: token.token_id },
      data: { used_at: new Date() },
    });
    await this.issueSession(token.user_id, ctx, res);
    return { ok: true };
  }

  /**
   * Cierra la sesión: revoca el refresh token presentado y borra las cookies.
   * Siempre responde 200, exista o no el token.
   *
   * @param refreshRaw - El refresh token en claro (de la cookie).
   * @param res - Respuesta (para borrar las cookies).
   */
  async logout(
    refreshRaw: string | undefined,
    res: Response,
  ): Promise<{ ok: true }> {
    if (refreshRaw) {
      await this.prisma.refresh_tokens.updateMany({
        where: { token_hash: sha256Hex(refreshRaw), revoked: false },
        data: { revoked: true },
      });
    }
    clearAuthCookies(res);
    return { ok: true };
  }

  // ────────────────────────── Contraseña ──────────────────────────

  /**
   * Cambia la contraseña con la sesión abierta. Revoca las demás sesiones y
   * re-emite la del dispositivo actual.
   *
   * @param userId - Usuario autenticado.
   * @param dto - Contraseña actual + nueva.
   * @param ctx - IP / User-Agent.
   * @param res - Respuesta (para la sesión re-emitida).
   * @throws UnauthorizedException si la contraseña actual no coincide.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: RequestContext,
    res: Response,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
    });
    if (!(await bcrypt.compare(dto.currentPassword, user.password_hash))) {
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: userId },
        data: {
          password_hash: await bcrypt.hash(dto.newPassword, BCRYPT_COST),
          must_change_password: false,
        },
      }),
      this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    await this.issueSession(userId, ctx, res);
    return { ok: true };
  }

  /**
   * Inicia el flujo de recuperación. Responde genérico SIEMPRE (no revela si
   * el correo existe). Si existe, crea un token de un solo uso y manda el
   * enlace.
   *
   * @param dto - El correo.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ ok: true }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (user) {
      const raw = generateOpaqueToken(32);
      await this.prisma.password_reset_tokens.create({
        data: {
          user_id: user.user_id,
          token_hash: sha256Hex(raw),
          expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const link = `${process.env.FRONTEND_URL}/restablecer?token=${raw}`;
      await this.mail.send(
        email,
        'Restablece tu contraseña — Galería',
        `<p>Hola ${escapeHtml(user.name ?? '')}, usa este enlace (válido 1 hora):</p>` +
          `<p><a href="${link}">${link}</a></p>` +
          `<p>Si no lo pediste, ignora este correo.</p>`,
      );
    }
    return { ok: true };
  }

  /**
   * Completa el restablecimiento con el token del correo.
   *
   * @param dto - `token` + nueva contraseña.
   * @throws UnauthorizedException con mensaje genérico si el token no es
   *         válido, ya se usó o expiró.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const record = await this.prisma.password_reset_tokens.findUnique({
      where: { token_hash: sha256Hex(dto.token) },
    });
    if (!record || record.used_at || record.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException('El enlace no es válido o ya expiró.');
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: record.user_id },
        data: {
          password_hash: await bcrypt.hash(dto.newPassword, BCRYPT_COST),
          must_change_password: false,
        },
      }),
      this.prisma.password_reset_tokens.update({
        where: { token_id: record.token_id },
        data: { used_at: new Date() },
      }),
      this.prisma.refresh_tokens.updateMany({
        where: { user_id: record.user_id, revoked: false },
        data: { revoked: true },
      }),
    ]);
    return { ok: true };
  }

  // ────────────────────────── Internos ──────────────────────────

  /**
   * Emite un par access/refresh nuevo y fija las cookies.
   *
   * @param userId - Dueño de la sesión.
   * @param ctx - IP / User-Agent (se guardan con el refresh token).
   * @param res - Respuesta donde se fijan las cookies.
   */
  private async issueSession(
    userId: string,
    ctx: RequestContext,
    res: Response,
  ): Promise<void> {
    const accessTtl = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
    const refreshTtl = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
    const refreshMs = durationToMs(refreshTtl);

    const accessToken = this.jwt.sign(
      { sub: userId, purpose: 'access' } satisfies JwtPayload,
      { algorithm: 'HS256', expiresIn: durationToSeconds(accessTtl) },
    );
    const refreshRaw = generateOpaqueToken(32);

    await this.prisma.refresh_tokens.create({
      data: {
        user_id: userId,
        token_hash: sha256Hex(refreshRaw),
        ip_address: ctx.ip ?? null,
        user_agent: ctx.userAgent ?? null,
        expires_at: new Date(Date.now() + refreshMs),
      },
    });

    setAuthCookies(res, accessToken, refreshRaw, durationToMs(accessTtl), refreshMs);
  }

  /**
   * Marca como usado el primer código de recuperación que coincida.
   *
   * @param userId - Dueño de los códigos.
   * @param code - El código que tecleó el usuario.
   * @returns `true` si había un código sin usar que coincidía (y quedó marcado).
   */
  private async consumeRecoveryCode(
    userId: string,
    code: string,
  ): Promise<boolean> {
    const candidates = await this.prisma.totp_recovery_codes.findMany({
      where: { user_id: userId, used_at: null },
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(code, candidate.code_hash)) {
        await this.prisma.totp_recovery_codes.update({
          where: { code_id: candidate.code_id },
          data: { used_at: new Date() },
        });
        return true;
      }
    }
    return false;
  }

  /** Proyecta una fila `users` (con su rol) al objeto de sesión. */
  private toAuthenticatedUser(user: {
    user_id: string;
    email: string;
    must_change_password: boolean;
    totp_enabled: boolean;
    roles: { name: string; level: number };
  }): AuthenticatedUser {
    return {
      userId: user.user_id,
      email: user.email,
      roleName: user.roles.name,
      roleLevel: user.roles.level,
      mustChangePassword: user.must_change_password,
      totpEnabled: user.totp_enabled,
    };
  }
}
