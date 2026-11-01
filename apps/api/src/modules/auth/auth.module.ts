import type { PrismaClient } from '@accordo/db';
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { Mailer } from '../notifications/email.provider.js';
import { PRISMA, REDIS } from '../platform/infra.providers.js';
import { createAuth } from './auth.factory.js';
import { AuthGuard } from './auth.guard.js';
import { AUTH } from './auth.tokens.js';
import { DevicesService } from './devices.service.js';
import { NotMeController } from './not-me.controller.js';
import { StepUpController } from './step-up.controller.js';
import { StepUpService } from './step-up.service.js';

@Global()
@Module({
  controllers: [StepUpController, NotMeController],
  providers: [
    DevicesService,
    StepUpService,
    {
      provide: AUTH,
      inject: [ENV, PRISMA, REDIS, Mailer, DevicesService, StepUpService],
      useFactory: (
        env: Env,
        db: PrismaClient,
        redis: Redis,
        mailer: Mailer,
        devices: DevicesService,
        stepUp: StepUpService,
      ) => createAuth({ env, db, redis, mailer, devices, stepUp }),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH, StepUpService, DevicesService],
})
export class AuthModule {}
