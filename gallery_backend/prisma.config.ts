import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuración del CLI de Prisma (Prisma 7).
 *
 * Desde Prisma 7 la URL de conexión ya no se declara en `schema.prisma`:
 * el CLI de Migrate / Studio la toma de aquí y el `PrismaClient` en runtime
 * la recibe por un driver adapter (ver `src/common/prisma/prisma.service.ts`).
 *
 * Prisma 7 tampoco carga el `.env` de forma automática. Se usa
 * `process.loadEnvFile` (nativo en Node 20.6+, sin dependencia extra). Si el
 * archivo no existe — p. ej. dentro del contenedor, donde las variables las
 * inyecta docker-compose — se ignora en silencio.
 */
try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  // .env ausente: las variables ya vienen del entorno del proceso.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    // seed: se añade en la Fase 2, cuando exista prisma/seed.ts.
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
