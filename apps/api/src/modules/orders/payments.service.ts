import type { PrismaClient } from '@accordo/db';
import {
  fakeWebhookBody,
  InvalidWebhookSignatureError,
  type PaymentEvent,
  type PaymentProvider,
  signFakeWebhook,
} from '@accordo/payments';
import type { BalanceDto, PaymentAccountDto } from '@accordo/shared';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PAYMENTS, PRISMA } from '../platform/infra.providers.js';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(PAYMENTS) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Seller onboarding (SPEC §6.2) ─────────────

  async onboarding(userId: string): Promise<{ url: string }> {
    let account = await this.db.paymentAccount.findUnique({ where: { userId } });
    if (!account) {
      const user = await this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, name: true },
      });
      const { accountId } = await this.provider.createConnectedAccount({
        userId,
        email: user.email,
        displayName: user.name,
      });
      account = await this.db.paymentAccount.create({
        data: { userId, provider: this.provider.name, providerAccountId: accountId },
      });
    }
    return this.provider.onboardingLink(account.providerAccountId, {
      returnUrl: `${this.env.WEB_URL}/account/incassi?onboarding=return`,
      refreshUrl: `${this.env.WEB_URL}/account/incassi?onboarding=refresh`,
    });
  }

  rawAccount(userId: string) {
    return this.db.paymentAccount.findUnique({ where: { userId } });
  }

  async account(userId: string): Promise<PaymentAccountDto | null> {
    const a = await this.db.paymentAccount.findUnique({ where: { userId } });
    return a
      ? {
          provider: a.provider,
          transfersEnabled: a.transfersEnabled,
          payoutsEnabled: a.payoutsEnabled,
          detailsSubmitted: a.detailsSubmitted,
          disabledReason: a.disabledReason,
        }
      : null;
  }

  /** From the ledger (SPEC §11.2): what is owed, scheduled and already transferred. */
  async balance(userId: string): Promise<BalanceDto> {
    const [payable, transferred, scheduled] = await Promise.all([
      this.db.ledgerEntry.groupBy({
        by: ['direction'],
        where: { account: 'SELLER_PAYABLE', userId },
        _sum: { amountCents: true },
      }),
      this.db.ledgerEntry.aggregate({
        where: {
          account: 'SELLER_PAYABLE',
          userId,
          direction: 'DEBIT',
          transaction: { type: 'TRANSFER_TO_SELLER' },
        },
        _sum: { amountCents: true },
      }),
      this.db.order.aggregate({
        where: {
          sellerId: userId,
          status: 'COMPLETED',
          payoutStatus: { in: ['SCHEDULED', 'ON_HOLD'] },
        },
        _sum: { sellerNetCents: true },
      }),
    ]);
    const sum = (d: 'DEBIT' | 'CREDIT') =>
      payable.find((p) => p.direction === d)?._sum.amountCents ?? 0;
    const owed = sum('CREDIT') - sum('DEBIT');
    const scheduledCents = scheduled._sum.sellerNetCents ?? 0;
    return {
      heldCents: Math.max(owed - scheduledCents, 0),
      scheduledCents,
      transferredCents: transferred._sum.amountCents ?? 0,
    };
  }

  // ───────────── Webhooks (SPEC §6.10) ─────────────

  /**
   * Verifies the signature on the raw body, stores the event once (`provider` + `eventId`) and
   * queues its processing through the outbox in the same transaction; duplicates are acknowledged.
   */
  async receiveWebhook(
    raw: Buffer,
    signature: string | undefined,
  ): Promise<{ duplicate: boolean }> {
    let parsed: ReturnType<PaymentProvider['parseWebhook']>;
    try {
      parsed = this.provider.parseWebhook(raw, signature);
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError || e instanceof SyntaxError)
        throw new BadRequestException({ code: 'INVALID_SIGNATURE' });
      throw e;
    }
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: {
          provider: this.provider.name,
          eventId: parsed.id,
          type: parsed.type,
          payload: { event: parsed.event as object } as object,
        },
        skipDuplicates: true,
      });
      if (count)
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'WebhookEvent',
            aggregateId: parsed.id,
            type: 'webhook.received',
            payload: { provider: this.provider.name, eventId: parsed.id },
          },
        });
      return { duplicate: count === 0 };
    });
  }

  /** Development only: a signed fake event through the real webhook path. */
  async simulate(event: PaymentEvent) {
    if (this.provider.name !== 'fake')
      throw new BadRequestException({ code: 'FAKE_PROVIDER_ONLY' });
    const body = fakeWebhookBody(event);
    return this.receiveWebhook(
      Buffer.from(body),
      signFakeWebhook(body, this.env.STRIPE_WEBHOOK_SECRET || 'fake-webhook-secret'),
    );
  }
}
