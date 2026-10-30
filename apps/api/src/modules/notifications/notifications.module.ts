import { createEmailProvider } from '@accordo/emails';
import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { EMAIL_PROVIDER, Mailer } from './email.provider.js';
import { NotificationsController } from './notifications.controller.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: EMAIL_PROVIDER, inject: [ENV], useFactory: (env: Env) => createEmailProvider(env) },
    Mailer,
  ],
  exports: [Mailer, EMAIL_PROVIDER],
})
export class NotificationsModule {}
