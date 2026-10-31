import type { PaymentProvider } from '@accordo/payments';
import { FAKE_SIGNATURE_HEADER } from '@accordo/payments';
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { PAYMENTS } from '../platform/infra.providers.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENTS) private readonly provider: PaymentProvider,
  ) {}

  /** Raw body (mounted before the JSON parser in app.setup.ts); 2xx as soon as it is stored. */
  @Post('stripe')
  @Public()
  @HttpCode(200)
  async stripe(@Req() req: Request) {
    const header = this.provider.name === 'fake' ? FAKE_SIGNATURE_HEADER : 'stripe-signature';
    const { duplicate } = await this.payments.receiveWebhook(
      req.body as Buffer,
      req.headers[header] as string | undefined,
    );
    return { received: true, duplicate };
  }
}

const outcome = z.object({ outcome: z.enum(['succeeded', 'failed']) });

/** Simulations for development and e2e with the fake provider; 404 in production. */
@Controller('dev')
export class DevPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private guard() {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
  }

  @Post('orders/:id/payment')
  @HttpCode(200)
  async pay(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: outcome }) body: z.infer<typeof outcome>,
  ) {
    this.guard();
    const o = await this.orders.party(auth.user.id, id);
    if (o.buyerId !== auth.user.id || !o.paymentIntentId) throw new ForbiddenException();
    return this.payments.simulate(
      body.outcome === 'succeeded'
        ? {
            kind: 'payment.succeeded',
            paymentIntentId: o.paymentIntentId,
            chargeId: `fake_ch_${o.id}`,
            amountCents: o.totalCents,
            currency: o.currency.toLowerCase(),
            orderId: o.id,
          }
        : { kind: 'payment.failed', paymentIntentId: o.paymentIntentId, orderId: o.id },
    );
  }

  @Post('payments/onboarding-complete')
  @HttpCode(200)
  async onboarded(@CurrentAuth() auth: AuthSession) {
    this.guard();
    const account = await this.payments.rawAccount(auth.user.id);
    if (!account) throw new NotFoundException();
    return this.payments.simulate({
      kind: 'account.updated',
      accountId: account.providerAccountId,
    });
  }

  /** Makes the order's pending timer due now (the sweeper runs it within a minute). */
  @Post('orders/:id/run-timer')
  @HttpCode(204)
  async runTimer(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    await this.orders.party(auth.user.id, id);
    await this.orders.dueNow(id);
  }
}
