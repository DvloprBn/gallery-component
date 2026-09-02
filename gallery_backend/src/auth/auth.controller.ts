import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService, type RequestContext } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { REFRESH_COOKIE } from './cookies';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  Login2faDto,
  LoginStep1Dto,
  LoginStep2Dto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import type { AuthenticatedUser } from './jwt-payload.interface';

/** Extrae IP y User-Agent de la petición para el registro de eventos. */
function ctxOf(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

/** Lee el refresh token de la cookie httpOnly. */
function refreshCookie(req: Request): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Alta pública (deja la sesión iniciada)' })
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(dto, ctxOf(req), res);
  }

  @Public()
  @Post('login/step1')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paso 1 del login — solo el correo' })
  loginStep1(@Body() _dto: LoginStep1Dto) {
    return this.auth.loginStep1();
  }

  @Public()
  @Post('login/step2')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paso 2 — contraseña (o pide 2FA)' })
  loginStep2(
    @Body() dto: LoginStep2Dto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.loginStep2(dto, ctxOf(req), res);
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paso 3 — código TOTP o de recuperación' })
  login2fa(
    @Body() dto: Login2faDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login2fa(dto, ctxOf(req), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rota la sesión con el refresh token de la cookie' })
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(refreshCookie(req), ctxOf(req), res);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cierra la sesión' })
  logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(refreshCookie(req), res);
  }

  @Get('me')
  @ApiOperation({ summary: 'Datos de la sesión actual' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Cambia la contraseña (con sesión abierta)' })
  changePassword(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.changePassword(userId, dto, ctxOf(req), res);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Envía el enlace de restablecimiento (respuesta genérica)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restablece la contraseña con el token del correo' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}
