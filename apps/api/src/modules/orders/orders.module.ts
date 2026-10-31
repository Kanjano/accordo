import { Module } from '@nestjs/common';
import { IdempotencyService } from '../platform/idempotency.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
import { DevPaymentsController, WebhooksController } from './webhooks.controller.js';

@Module({
  controllers: [OrdersController, WebhooksController, DevPaymentsController],
  providers: [OrdersService, PaymentsService, IdempotencyService],
})
export class OrdersModule {}
