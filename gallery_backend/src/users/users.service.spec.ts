import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import type { MailService } from '../mail/mail.service';
import { UsersService } from './users.service';

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

/** MailService que nunca entrega — así `create` devuelve `tempPassword`. */
const mailStub = {
  send: jest.fn().mockResolvedValue({ delivered: false }),
} as unknown as MailService;

describe('UsersService (integración, Postgres real)', () => {
  let prisma: PrismaService;
  let service: UsersService;
  const tag = `t_${randomBytes(3).toString('hex')}`;
  let roleLvl1: number;
  let roleSolo: number; // max_count = 1

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new UsersService(prisma, mailStub);

    roleLvl1 = (
      await prisma.roles.create({ data: { name: `${tag}_l1`, level: 1 } })
    ).role_id;
    roleSolo = (
      await prisma.roles.create({ data: { name: `${tag}_solo`, level: 1, max_count: 1 } })
    ).role_id;
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { email: { contains: `+${tag}@` } } });
    await prisma.roles.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.onModuleDestroy();
  });

  it('un actor no puede crear una cuenta de nivel igual o superior al suyo', async () => {
    const director = await prisma.roles.findUniqueOrThrow({ where: { name: 'director' } }); // nivel 4
    const before = await prisma.users.count();
    await expect(
      service.create(
        { email: `d+${tag}@example.com`, name: 'D', roleId: director.role_id },
        actor(3),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.users.count()).toBe(before);
  });

  it('un actor sí puede crear una cuenta de nivel estrictamente menor', async () => {
    const created = await service.create(
      { email: `ok+${tag}@example.com`, name: 'OK', roleId: roleLvl1 },
      actor(3),
    );
    expect(created.email).toBe(`ok+${tag}@example.com`);
    expect('tempPassword' in created).toBe(true); // el correo no se entregó
    const row = await prisma.users.findUnique({ where: { email: `ok+${tag}@example.com` } });
    expect(row?.must_change_password).toBe(true);
  });

  it('respeta max_count contra cuentas activas', async () => {
    await service.create(
      { email: `solo1+${tag}@example.com`, name: 'S1', roleId: roleSolo },
      actor(5),
    );
    await expect(
      service.create(
        { email: `solo2+${tag}@example.com`, name: 'S2', roleId: roleSolo },
        actor(5),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.users.count({ where: { role_id: roleSolo } }),
    ).toBe(1);
  });

  it('excluye a la propia cuenta al reconfirmarle su mismo rol con max_count=1', async () => {
    const u = await prisma.users.findUniqueOrThrow({
      where: { email: `solo1+${tag}@example.com` },
    });
    const updated = await service.update(u.user_id, { roleId: roleSolo }, actor(5));
    expect(updated.role.roleId).toBe(roleSolo); // no lanza "ya hay 1"
  });

  it('no deja gestionar una cuenta de nivel igual o superior al del actor', async () => {
    const u = await prisma.users.findUniqueOrThrow({
      where: { email: `ok+${tag}@example.com` }, // rol nivel 1
    });
    await expect(
      service.update(u.user_id, { isActive: false }, actor(1)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.users.findUnique({ where: { user_id: u.user_id } }))?.is_active).toBe(true);
  });

  it('un actor no puede gestionarse a sí mismo por esta vía', async () => {
    const self = await prisma.users.findUniqueOrThrow({
      where: { email: `solo1+${tag}@example.com` },
    });
    await expect(
      service.update(
        self.user_id,
        { isActive: false },
        { ...actor(9), userId: self.user_id },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
