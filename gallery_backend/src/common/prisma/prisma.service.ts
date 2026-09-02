import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Construye el driver adapter de PostgreSQL que Prisma 7 necesita para
 * conectarse (ya no hay motor Rust embebido: las consultas van por `pg`).
 *
 * @returns Un `PrismaPg` configurado con `DATABASE_URL`.
 * @throws Error si `DATABASE_URL` no está definida.
 */
function buildAdapter(): PrismaPg {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL no está definida.');
  }
  return new PrismaPg({ connectionString: url });
}

/**
 * Cliente de base de datos compartido por toda la aplicación.
 *
 * Extiende `PrismaClient` y lo integra al ciclo de vida de NestJS: abre la
 * conexión cuando el módulo se inicializa y la cierra de forma limpia
 * cuando la aplicación se apaga — evita conexiones colgadas durante la
 * recarga en caliente del desarrollo.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: buildAdapter() });
  }

  /**
   * Abre la conexión a PostgreSQL al iniciar el módulo.
   *
   * @throws Si la base de datos no acepta la conexión (credenciales, red o
   *         servidor caído) — hace fallar el arranque a propósito.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexión a PostgreSQL establecida.');
  }

  /** Cierra la conexión a PostgreSQL al apagar la aplicación. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
