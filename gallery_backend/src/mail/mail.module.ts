import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Expone `MailService` de forma global. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
