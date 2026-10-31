import {
  cancelSchema,
  handoverVerifySchema,
  type OrderCreate,
  orderCreateSchema,
  shipSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth, RequireStepUp, Roles } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { IdempotencyService } from '../platform/idempotency.service.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';

type Auth = AuthSession;

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('orders')
  checkout(
    @CurrentAuth() auth: Auth,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: orderCreateSchema }) body: OrderCreate,
  ) {
    return this.idempotency.run(auth.user.id, key, 'POST /orders', body, () =>
      this.orders.checkout(auth.user.id, body),
    );
  }

  @Get('me/orders')
  list(@CurrentAuth() auth: Auth, @Query('role') role = 'buyer', @Query('status') status?: string) {
    if (role !== 'buyer' && role !== 'seller')
      throw new BadRequestException({ code: 'INVALID_ROLE' });
    return this.orders.list(auth.user.id, role, status);
  }

  @Get('orders/:id')
  detail(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(auth.user.id, id);
  }

  @Get('orders/:id/payment')
  payment(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.paymentSecret(auth.user.id, id);
  }

  @Post('orders/:id/ship')
  ship(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: shipSchema }) body: z.infer<typeof shipSchema>,
  ) {
    return this.orders.ship(auth.user.id, id, body.carrier, body.trackingNumber);
  }

  @Post('orders/:id/confirm-receipt')
  @RequireStepUp()
  confirm(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.idempotency.run(auth.user.id, key, `POST /orders/${id}/confirm-receipt`, {}, () =>
      this.orders.confirmReceipt(auth.user.id, id),
    );
  }

  @Get('orders/:id/handover-code')
  @RequireStepUp()
  handoverCode(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.handoverCode(auth.user.id, id);
  }

  @Post('orders/:id/handover/verify')
  @HttpCode(200)
  verify(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: handoverVerifySchema }) body: z.infer<typeof handoverVerifySchema>,
  ) {
    return this.orders.verifyHandover(auth.user.id, id, body.code);
  }

  @Post('orders/:id/cancel')
  cancel(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: cancelSchema }) body: z.infer<typeof cancelSchema>,
  ) {
    return this.orders.cancel(auth.user.id, id, body.reason);
  }

  @Post('orders/:id/cancel-requests')
  requestCancel(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: cancelSchema }) body: z.infer<typeof cancelSchema>,
  ) {
    return this.orders.requestCancel(auth.user.id, id, body.reason);
  }

  @Post('orders/:id/cancel-requests/accept')
  acceptCancel(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.acceptCancel(auth.user.id, id);
  }

  // ───────────── Payments ─────────────

  @Post('payments/onboarding')
  @RequireStepUp()
  onboarding(@CurrentAuth() auth: Auth) {
    return this.payments.onboarding(auth.user.id);
  }

  @Get('payments/account')
  account(@CurrentAuth() auth: Auth) {
    return this.payments.account(auth.user.id).then((a) => a ?? { provider: null });
  }

  @Get('me/balance')
  balance(@CurrentAuth() auth: Auth) {
    return this.payments.balance(auth.user.id);
  }

  // ───────────── Back office (SPEC §3.10) ─────────────

  @Get('admin/orders')
  @Roles('admin', 'support')
  async adminList(@Query('status') status?: string, @Query('q') q?: string) {
    return this.orders.adminList(status, q);
  }

  @Get('admin/orders/:id')
  @Roles('admin', 'support')
  adminDetail(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(auth.user.id, id, true);
  }
}
