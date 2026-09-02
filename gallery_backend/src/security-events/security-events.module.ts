import { Global, Module } from '@nestjs/common';
import { SecurityEventsService } from './security-events.service';

/** Expone `SecurityEventsService` de forma global (lo usan `auth` y `two-factor`). */
@Global()
@Module({
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
