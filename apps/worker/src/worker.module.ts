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
import { OffersProcessor, OffersScheduler } from './offers.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { ChargebackService } from './payments/chargebacks.js';
import { NightlyChecks, OrdersScheduler, OrdersSweeper } from './payments/orders-sweeper.js';
import { PaymentsProcessor } from './payments/payments.processor.js';
import { QUEUES } from './queues.js';
import { ReputationProcessor, ReputationScheduler } from './reputation.js';
import { SavedSearchAlertsProcessor, SavedSearchScheduler } from './search/saved-search-alerts.js';
import { SearchIndexBootstrap, SearchIndexProcessor } from './search/search-index.processor.js';
import { ShippingProcessor } from './shipping/shipping.processor.js';
import { ShippingService } from './shipping/shipping.service.js';

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
      { name: QUEUES.searchIndex },
      { name: QUEUES.savedSearchAlerts },
      { name: QUEUES.offers },
      { name: QUEUES.payments },
      { name: QUEUES.orders },
      { name: QUEUES.nightly },
      { name: QUEUES.shipping },
      { name: QUEUES.reputation },
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
    SearchIndexBootstrap,
    SearchIndexProcessor,
    SavedSearchScheduler,
    SavedSearchAlertsProcessor,
    OffersScheduler,
    OffersProcessor,
    PaymentsProcessor,
    ChargebackService,
    OrdersScheduler,
    OrdersSweeper,
    NightlyChecks,
    ShippingService,
    ShippingProcessor,
    ReputationScheduler,
    ReputationProcessor,
  ],
})
export class WorkerModule {}
