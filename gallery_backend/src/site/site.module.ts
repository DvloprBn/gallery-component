import { Global, Module } from '@nestjs/common';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';

/** Expone `SiteService` de forma global (lo usa `contact` para el correo). */
@Global()
@Module({
  controllers: [SiteController],
  providers: [SiteService],
  exports: [SiteService],
})
export class SiteModule {}
