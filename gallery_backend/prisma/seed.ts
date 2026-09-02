import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Seed idempotente: roles del catálogo + una cuenta de prueba por rol.
 * Se puede correr tantas veces como haga falta (usa `upsert`).
 *
 * No es un negocio real — los correos son `@example.com` a propósito (el repo
 * es público). La contraseña de todas las cuentas de prueba es la misma.
 */
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

/** Jerarquía de autoridad. `is_system` protege de borrado; `director`/`super` son de una sola persona. */
const ROLES = [
  { name: 'usuario', level: 0, max_count: null, description: 'Cuenta pública, dueña de sus propios álbumes' },
  { name: 'staff', level: 1, max_count: null, description: 'Apoyo operativo' },
  { name: 'manager', level: 2, max_count: null, description: 'Gestión de un área' },
  { name: 'admin', level: 3, max_count: null, description: 'Administración de cuentas y roles' },
  { name: 'director', level: 4, max_count: 1, description: 'Dirección — cargo de una sola persona' },
  { name: 'super', level: 5, max_count: 1, description: 'Superadministrador — cargo de una sola persona' },
] as const;

/** Contraseña de todas las cuentas sembradas. Solo para pruebas locales. */
const TEST_PASSWORD = 'TestOnly123!';

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.roles.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        level: role.level,
        max_count: role.max_count,
        is_system: true,
      },
      create: { ...role, is_system: true },
    });
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  for (const role of ROLES) {
    const email = `${role.name}+gallery@example.com`;
    const dbRole = await prisma.roles.findUniqueOrThrow({
      where: { name: role.name },
    });
    await prisma.users.upsert({
      where: { email },
      update: { role_id: dbRole.role_id, is_active: true },
      create: {
        email,
        password_hash: passwordHash,
        name: `${role.name[0].toUpperCase()}${role.name.slice(1)} de prueba`,
        role_id: dbRole.role_id,
      },
    });
  }

  const roleCount = await prisma.roles.count();
  const userCount = await prisma.users.count();
  console.log(
    `Seed OK — ${roleCount} roles, ${userCount} cuentas. Contraseña de prueba: ${TEST_PASSWORD}`,
  );
}

main()
  .catch((error) => {
    console.error('Seed falló:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
