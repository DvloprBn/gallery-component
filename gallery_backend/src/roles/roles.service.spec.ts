import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { RolesService } from './roles.service';

/** Construye un actor de prueba con el nivel indicado. */
function actor(level: number): AuthenticatedUser {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    email: `actor-lvl${level}@example.com`,
    roleName: 'test-actor',
    roleLevel: level,
    mustChangePassword: false,
    totpEnabled: false,
  };
}

describe('RolesService (integración, Postgres real)', () => {
  let prisma: PrismaService;
  let service: RolesService;
  const tag = `t_${randomBytes(3).toString('hex')}`;
  const createdRoleIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new RolesService(prisma);
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { email: { contains: `+${tag}@` } } });
    await prisma.roles.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.onModuleDestroy();
  });

  it('bloquea crear un rol de nivel igual o superior al del actor', async () => {
    await expect(
      service.create({ name: `${tag}_alto`, level: 3 }, actor(3)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // comprobación acotada (no un count global — otras suites corren en paralelo)
    expect(
      await prisma.roles.findUnique({ where: { name: `${tag}_alto` } }),
    ).toBeNull();
  });

  it('permite crear un rol de nivel estrictamente menor', async () => {
    const role = await service.create(
      { name: `${tag}_editor`, level: 2, description: 'de prueba' },
      actor(3),
    );
    createdRoleIds.push(role.role_id);
    expect(role.is_system).toBe(false);
    expect((await prisma.roles.findUnique({ where: { role_id: role.role_id } }))?.level).toBe(2);
  });

  it('no deja subir un rol a un nivel igual/mayor al del actor', async () => {
    const role = await service.create({ name: `${tag}_low`, level: 1 }, actor(5));
    createdRoleIds.push(role.role_id);
    await expect(
      service.update(role.role_id, { level: 5 }, actor(5)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.roles.findUnique({ where: { role_id: role.role_id } }))?.level).toBe(1);
  });

  it('protege un rol is_system del borrado', async () => {
    const systemRole = await prisma.roles.findFirstOrThrow({ where: { is_system: true } });
    await expect(
      service.remove(systemRole.role_id, actor(99)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.roles.findUnique({ where: { role_id: systemRole.role_id } })).not.toBeNull();
  });

  it('no borra un rol que tiene cuentas asignadas', async () => {
    const role = await service.create({ name: `${tag}_conuser`, level: 1 }, actor(5));
    createdRoleIds.push(role.role_id);
    await prisma.users.create({
      data: {
        email: `x+${tag}@example.com`,
        password_hash: 'x',
        role_id: role.role_id,
      },
    });
    await expect(
      service.remove(role.role_id, actor(5)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.roles.findUnique({ where: { role_id: role.role_id } })).not.toBeNull();
  });
});
