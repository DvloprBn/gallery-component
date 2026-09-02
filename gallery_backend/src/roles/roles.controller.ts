import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

/**
 * Gestión del catálogo de roles. Puerta gruesa: `admin` / `director` / `super`.
 * La regla fina (jerarquía de niveles) la aplica `RolesService`.
 */
@ApiTags('roles')
@Controller('roles')
@Roles('admin', 'director', 'super')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los roles con su conteo de cuentas' })
  list() {
    return this.roles.list();
  }

  @Post()
  @ApiOperation({ summary: 'Crea un rol dinámico' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roles.create(dto, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita un rol' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roles.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra un rol (409 si es de sistema o tiene cuentas)' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roles.remove(id, actor);
  }
}
