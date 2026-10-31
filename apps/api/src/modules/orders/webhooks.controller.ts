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
import { ShippingWebhooksService } from './shipping-webhooks.service.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly shippingWebhooks: ShippingWebhooksService,
    @Inject(PAYMENTS) private readonly provider: PaymentProvider,
  ) {}

  /** Carrier events of integrated shipments (SPEC §7.3), HMAC on the raw body. */
  @Post('shipping/:provider')
  @Public()
  @HttpCode(200)
  async shipping(@Param('provider') provider: string, @Req() req: Request) {
    return this.shippingWebhooks.receive(
      'shipping',
      provider,
      req.headers as Record<string, string | undefined>,
      req.body as Buffer,
    );
  }

  /** Tracking of self-shipped parcels. */
  @Post('tracking/:provider')
  @Public()
  @HttpCode(200)
  async tracking(@Param('provider') provider: string, @Req() req: Request) {
    return this.shippingWebhooks.receive(
      'tracking',
      provider,
      req.headers as Record<string, string | undefined>,
      req.body as Buffer,
    );
  }

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
const chargebackOutcome = z.object({ status: z.enum(['won', 'lost']) });

/** Simulations for development and e2e with the fake provider; 404 in production. */
@Controller('dev')
export class DevPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly shippingWebhooks: ShippingWebhooksService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Next tracking event of a mock shipment (SPEC §7.3). */
  @Post('shipments/:id/advance')
  @HttpCode(200)
  advance(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    return this.shippingWebhooks.advance(id, auth.user.id);
  }

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

  /** Runs the order's pending timer now (ship deadline, auto-completion, dispute deadline…). */
  @Post('orders/:id/run-timer')
  @HttpCode(200)
  async runTimer(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    await this.orders.party(auth.user.id, id);
    return this.orders.runTimerNow(id);
  }

  /** Simulated bank dispute (Stripe test card 4000 0000 0000 0259 with the real provider). */
  @Post('orders/:id/chargeback')
  @HttpCode(200)
  async chargeback(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    const o = await this.orders.party(auth.user.id, id);
    if (!o.chargeId) throw new NotFoundException();
    const disputeId = `fake_dp_${o.id}`;
    await this.payments.simulate({
      kind: 'dispute.created',
      disputeId,
      chargeId: o.chargeId,
      amountCents: o.totalCents,
      reason: 'fraudulent',
      evidenceDueBy: new Date(Date.now() + 7 * 86_400_000),
    });
    return { disputeId };
  }

  @Post('payment-disputes/:id/close')
  @HttpCode(200)
  async closeChargeback(
    @CurrentAuth() auth: AuthSession,
    @Param('id') id: string,
    @Body({ schema: chargebackOutcome }) body: z.infer<typeof chargebackOutcome>,
  ) {
    this.guard();
    const orderId = id.replace(/^fake_dp_/, '');
    const o = await this.orders.party(auth.user.id, orderId);
    return this.payments.simulate({
      kind: 'dispute.closed',
      disputeId: id,
      chargeId: o.chargeId as string,
      status: body.status,
      amountCents: o.totalCents,
    });
  }
}
