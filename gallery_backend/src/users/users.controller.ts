import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Administración de cuentas. Puerta gruesa: `admin` / `director` / `super`.
 * La regla fina (jerarquía, `max_count`, no gestionarse a sí mismo) la aplica
 * `UsersService`.
 */
@ApiTags('users')
@Controller('users')
@Roles('admin', 'director', 'super')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista las cuentas (vista segura, sin secretos)' })
  list() {
    return this.users.list();
  }

  @Post()
  @ApiOperation({ summary: 'Alta administrativa con contraseña temporal' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cambia rol y/o estado de una cuenta' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.update(id, dto, actor);
  }
}
