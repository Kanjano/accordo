import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from './env.js';
import { HEARTBEAT_QUEUE, HeartbeatProcessor, HeartbeatScheduler } from './heartbeat.js';
import { InfraModule } from './infra.js';
import { LifecycleProcessor, LifecycleScheduler } from './lifecycle.js';
import { MediaProcessor } from './media/media.processor.js';
import { NotificationsProcessor } from './notifications/notifications.processor.js';
import { Notifier } from './notifications/notifier.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { QUEUES } from './queues.js';

@Module({
  imports: [
    InfraModule,
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
    BullModule.registerQueue(
      { name: HEARTBEAT_QUEUE },
      { name: QUEUES.media },
      { name: QUEUES.notifications },
      { name: QUEUES.lifecycle },
    ),
  ],
  providers: [
    HeartbeatScheduler,
    HeartbeatProcessor,
    OutboxDispatcher,
    MediaProcessor,
    Notifier,
    NotificationsProcessor,
    LifecycleScheduler,
    LifecycleProcessor,
  ],
})
export class WorkerModule {}
