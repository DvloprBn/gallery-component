import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { escapeHtml } from '../common/utils/escape-html.util';
import { generateOpaqueToken } from '../common/utils/token.util';
import { MailService } from '../mail/mail.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const BCRYPT_COST = 12;

/** Vista pública de una cuenta — nunca incluye hash ni secreto TOTP. */
export interface SafeUser {
  userId: string;
  email: string;
  name: string | null;
  role: { roleId: number; name: string; level: number };
  isActive: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
}

/**
 * Administración de cuentas, con el mismo **candado de jerarquía** que
 * `RolesService`: un actor solo puede crear o gestionar una cuenta cuyo rol
 * esté en un nivel **estrictamente menor** al suyo — ni para desactivarla.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Lista todas las cuentas (rol más alto primero), en forma segura. */
  async list(): Promise<SafeUser[]> {
    const rows = await this.prisma.users.findMany({
      include: { roles: true },
      orderBy: [{ roles: { level: 'desc' } }, { created_at: 'asc' }],
    });
    return rows.map((u) => this.toSafeUser(u));
  }

  /**
   * Comprueba que el actor puede asignar/gestionar `roleId`, y que hacerlo no
   * rompe el `max_count` de ese rol.
   *
   * @param actor - Quien ejecuta la acción.
   * @param roleId - Rol que se quiere asignar.
   * @param excludeUserId - Cuenta a excluir del conteo (al reasignarle su
   *        mismo rol, no debe contar contra sí misma).
   * @returns El rol, ya validado.
   * @throws NotFoundException si el rol no existe.
   * @throws ForbiddenException si el rol está en un nivel >= al del actor.
   * @throws ConflictException si se superaría el `max_count` de cuentas activas.
   */
  private async assertCanManageRole(
    actor: AuthenticatedUser,
    roleId: number,
    excludeUserId?: string,
  ) {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
    });
    if (!role) {
      throw new NotFoundException('El rol indicado no existe.');
    }
    if (role.level >= actor.roleLevel) {
      throw new ForbiddenException(
        'No puedes gestionar cuentas de nivel igual o superior al tuyo.',
      );
    }
    if (role.max_count !== null) {
      const active = await this.prisma.users.count({
        where: {
          role_id: roleId,
          is_active: true,
          ...(excludeUserId ? { user_id: { not: excludeUserId } } : {}),
        },
      });
      if (active >= role.max_count) {
        throw new ConflictException(
          `El rol "${role.name}" admite máximo ${role.max_count} cuenta(s) activa(s) (hay ${active}).`,
        );
      }
    }
    return role;
  }

  /**
   * Alta administrativa. Genera una contraseña temporal, marca
   * `must_change_password` y manda el correo de bienvenida.
   *
   * @param dto - Correo, nombre, rol.
   * @param actor - Quien ejecuta la acción.
   * @returns La cuenta creada; incluye `tempPassword` **solo** si el correo
   *          no se pudo entregar (para no dejar al admin sin forma de pasarla).
   * @throws ConflictException si el correo ya existe.
   */
  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    await this.assertCanManageRole(actor, dto.roleId);
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.users.findUnique({ where: { email } })) {
      throw new ConflictException('Ese correo ya está registrado.');
    }

    const tempPassword = generateOpaqueToken(12);
    const user = await this.prisma.users.create({
      data: {
        email,
        name: dto.name.trim(),
        role_id: dto.roleId,
        password_hash: await bcrypt.hash(tempPassword, BCRYPT_COST),
        must_change_password: true,
      },
      include: { roles: true },
    });

    const mail = await this.mail.send(
      email,
      'Tu cuenta en Galería',
      `<p>Hola ${escapeHtml(dto.name)}, se creó tu cuenta.</p>` +
        `<p>Contraseña temporal: <code>${escapeHtml(tempPassword)}</code></p>` +
        `<p>Al iniciar sesión se te pedirá cambiarla.</p>`,
    );

    return {
      ...this.toSafeUser(user),
      welcomeEmailSent: mail.delivered,
      ...(mail.delivered ? {} : { tempPassword }),
    };
  }

  /**
   * Cambia rol y/o estado de una cuenta.
   *
   * @param targetUserId - Cuenta a modificar.
   * @param dto - `roleId` y/o `isActive`.
   * @param actor - Quien ejecuta la acción.
   * @throws NotFoundException si la cuenta no existe.
   * @throws ForbiddenException si la cuenta está en un nivel >= al del actor,
   *         o si el actor intenta gestionarse a sí mismo por esta vía.
   */
  async update(
    targetUserId: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
  ): Promise<SafeUser> {
    const target = await this.prisma.users.findUnique({
      where: { user_id: targetUserId },
      include: { roles: true },
    });
    if (!target) {
      throw new NotFoundException('Cuenta no encontrada.');
    }
    if (target.user_id === actor.userId) {
      throw new ForbiddenException(
        'No puedes cambiar tu propio rol o estado por esta vía.',
      );
    }
    if (target.roles.level >= actor.roleLevel) {
      throw new ForbiddenException(
        'No puedes gestionar una cuenta de nivel igual o superior al tuyo.',
      );
    }

    const data: { role_id?: number; is_active?: boolean } = {};
    if (dto.roleId !== undefined && dto.roleId !== target.role_id) {
      await this.assertCanManageRole(actor, dto.roleId, target.user_id);
      data.role_id = dto.roleId;
    }
    if (dto.isActive !== undefined) {
      data.is_active = dto.isActive;
    }

    const updated = await this.prisma.users.update({
      where: { user_id: targetUserId },
      data,
      include: { roles: true },
    });
    return this.toSafeUser(updated);
  }

  /** Proyecta una fila `users` (con su rol) a la vista segura. */
  private toSafeUser(u: {
    user_id: string;
    email: string;
    name: string | null;
    is_active: boolean;
    totp_enabled: boolean;
    must_change_password: boolean;
    created_at: Date;
    roles: { role_id: number; name: string; level: number };
  }): SafeUser {
    return {
      userId: u.user_id,
      email: u.email,
      name: u.name,
      role: { roleId: u.roles.role_id, name: u.roles.name, level: u.roles.level },
      isActive: u.is_active,
      totpEnabled: u.totp_enabled,
      mustChangePassword: u.must_change_password,
      createdAt: u.created_at,
    };
  }
}
