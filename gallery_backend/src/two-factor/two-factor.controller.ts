import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DisableTwoFactorDto, TotpCodeDto } from './dto/two-factor.dto';
import { TwoFactorService } from './two-factor.service';

/**
 * Activación y gestión de 2FA. Todas las rutas requieren sesión iniciada
 * (guard global), pero ningún rol especial — cualquiera puede proteger su
 * propia cuenta.
 */
@ApiTags('two-factor')
@Controller('two-factor')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  @ApiOperation({ summary: 'Genera el secreto y el QR (todavía sin activar)' })
  setup(@CurrentUser('userId') userId: string) {
    return this.twoFactor.setup(userId);
  }

  @Post('confirm-setup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activa 2FA con el primer código y entrega los códigos de recuperación' })
  confirmSetup(
    @CurrentUser('userId') userId: string,
    @Body() dto: TotpCodeDto,
  ) {
    return this.twoFactor.confirmSetup(userId, dto.code);
  }

  @Post('disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desactiva 2FA (pide la contraseña)' })
  disable(
    @CurrentUser('userId') userId: string,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.twoFactor.disable(userId, dto.password);
  }

  @Post('recovery-codes/regenerate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Regenera los códigos de recuperación (pide un código TOTP)' })
  regenerate(
    @CurrentUser('userId') userId: string,
    @Body() dto: TotpCodeDto,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(userId, dto.code);
  }
}
