import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env, parseEnv } from './env.js';
import { HEARTBEAT_QUEUE, HeartbeatProcessor, HeartbeatScheduler } from './heartbeat.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ connection: { url: env.REDIS_URL } }),
    }),
    BullModule.registerQueue({ name: HEARTBEAT_QUEUE }),
  ],
  providers: [HeartbeatScheduler, HeartbeatProcessor],
})
export class WorkerModule {}
