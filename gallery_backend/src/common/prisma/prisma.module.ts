import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Expone `PrismaService` de forma global: cualquier módulo puede inyectarlo
 * sin volver a importar este módulo.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
