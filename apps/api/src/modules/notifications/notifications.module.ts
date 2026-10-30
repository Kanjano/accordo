import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { createEmailProvider, EMAIL_PROVIDER, Mailer } from './email.provider.js';

@Global()
@Module({
  providers: [
    { provide: EMAIL_PROVIDER, inject: [ENV], useFactory: (env: Env) => createEmailProvider(env) },
    Mailer,
  ],
  exports: [Mailer, EMAIL_PROVIDER],
})
export class NotificationsModule {}
