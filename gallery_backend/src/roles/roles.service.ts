import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/**
 * CRUD de roles dinámicos, con el **candado de jerarquía**: nadie puede crear
 * ni dejar un rol en un nivel igual o superior al suyo — eso sería crearse un
 * jefe imaginario con más autoridad que la propia (escalada de privilegios).
 */
@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista todos los roles, del nivel más bajo al más alto, con el conteo de
   * cuentas asignadas.
   */
  list() {
    return this.prisma.roles.findMany({
      orderBy: { level: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  /**
   * Crea un rol.
   *
   * @param dto - Datos del rol.
   * @param actor - Quien ejecuta la acción.
   * @throws ForbiddenException si `dto.level >= actor.roleLevel`.
   * @throws ConflictException si el nombre ya existe.
   */
  async create(dto: CreateRoleDto, actor: AuthenticatedUser) {
    if (dto.level >= actor.roleLevel) {
      throw new ForbiddenException(
        'No puedes crear un rol de tu mismo nivel o superior.',
      );
    }
    const clash = await this.prisma.roles.findUnique({
      where: { name: dto.name },
    });
    if (clash) {
      throw new ConflictException('Ya existe un rol con ese nombre.');
    }
    return this.prisma.roles.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        level: dto.level,
        max_count: dto.maxCount ?? null,
        is_system: false,
      },
    });
  }

  /**
   * Edita un rol.
   *
   * @param roleId - Rol a editar.
   * @param dto - Cambios.
   * @param actor - Quien ejecuta la acción.
   * @throws NotFoundException si el rol no existe.
   * @throws ConflictException si es un rol de sistema y se intenta cambiar su
   *         nivel o su cupo.
   * @throws ForbiddenException si el rol (o el nivel nuevo) está en un nivel
   *         igual o superior al del actor.
   */
  async update(roleId: number, dto: UpdateRoleDto, actor: AuthenticatedUser) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });
    if (!role) {
      throw new NotFoundException('Rol no encontrado.');
    }
    if (
      role.is_system &&
      (dto.level !== undefined || dto.maxCount !== undefined)
    ) {
      throw new ConflictException(
        'Un rol de sistema no puede cambiar de nivel ni de cupo.',
      );
    }
    if (role.level >= actor.roleLevel) {
      throw new ForbiddenException('No puedes editar un rol de nivel igual o superior al tuyo.');
    }
    if (dto.level !== undefined && dto.level >= actor.roleLevel) {
      throw new ForbiddenException('No puedes subir un rol a tu nivel o por encima.');
    }
    return this.prisma.roles.update({
      where: { role_id: roleId },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.maxCount !== undefined ? { max_count: dto.maxCount } : {}),
      },
    });
  }

  /**
   * Borra un rol.
   *
   * @param roleId - Rol a borrar.
   * @param actor - Quien ejecuta la acción.
   * @throws NotFoundException si no existe.
   * @throws ConflictException si es de sistema o tiene cuentas asignadas.
   * @throws ForbiddenException si está en un nivel igual o superior al del actor.
   */
  async remove(roleId: number, actor: AuthenticatedUser): Promise<void> {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) {
      throw new NotFoundException('Rol no encontrado.');
    }
    if (role.is_system) {
      throw new ConflictException('Un rol de sistema no se puede borrar.');
    }
    if (role.level >= actor.roleLevel) {
      throw new ForbiddenException('No puedes borrar un rol de nivel igual o superior al tuyo.');
    }
    if (role._count.users > 0) {
      throw new ConflictException(
        `El rol tiene ${role._count.users} cuenta(s) asignada(s).`,
      );
    }
    await this.prisma.roles.delete({ where: { role_id: roleId } });
  }
}
