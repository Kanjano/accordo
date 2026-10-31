import Stripe from 'stripe';
import {
  type ConnectedAccountStatus,
  InvalidWebhookSignatureError,
  type ParsedWebhook,
  type PaymentEvent,
  type PaymentProvider,
} from './port.js';

/**
 * Stripe Connect "marketplace" (SPEC §6.1): Accounts v2 recipients (express dashboard, losses on
 * the platform), separate charges and transfers with `source_transaction`. Not yet exercised
 * against a real test account (ADR-0037).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });
  }

  async createConnectedAccount(i: { userId: string; email: string; displayName: string }) {
    const account = await this.stripe.v2.core.accounts.create(
      {
        contact_email: i.email,
        display_name: i.displayName,
        dashboard: 'express',
        identity: { country: 'it' },
        defaults: {
          responsibilities: { losses_collector: 'application', fees_collector: 'application' },
        },
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { userId: i.userId },
      },
      { idempotencyKey: `account:${i.userId}` },
    );
    return { accountId: account.id };
  }

  async onboardingLink(accountId: string, urls: { returnUrl: string; refreshUrl: string }) {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          return_url: urls.returnUrl,
          refresh_url: urls.refreshUrl,
        },
      },
    });
    return { url: link.url };
  }

  async accountStatus(accountId: string): Promise<ConnectedAccountStatus> {
    const a = await this.stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient', 'requirements'],
    });
    const transfers = a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
    const due = a.requirements?.entries ?? [];
    return {
      transfersEnabled: transfers?.status === 'active',
      payoutsEnabled: transfers?.status === 'active',
      detailsSubmitted: due.length === 0,
      requirements: a.requirements ?? null,
      disabledReason: transfers?.status === 'active' ? null : (transfers?.status ?? 'unknown'),
    };
  }

  async createPaymentIntent(i: {
    amountCents: number;
    currency: string;
    transferGroup: string;
    orderId: string;
    idempotencyKey: string;
  }) {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: i.amountCents,
        currency: i.currency.toLowerCase(),
        transfer_group: i.transferGroup,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: i.orderId },
      },
      { idempotencyKey: i.idempotencyKey },
    );
    return { id: pi.id, clientSecret: pi.client_secret as string };
  }

  async cancelPaymentIntent(id: string, idempotencyKey: string) {
    await this.stripe.paymentIntents.cancel(id, {}, { idempotencyKey });
  }

  async processorFee(chargeId: string) {
    const charge = await this.stripe.charges.retrieve(chargeId, {
      expand: ['balance_transaction'],
    });
    const bt = charge.balance_transaction;
    return bt && typeof bt === 'object' ? bt.fee : null;
  }

  async createTransfer(i: {
    amountCents: number;
    currency: string;
    destination: string;
    sourceTransaction: string;
    transferGroup: string;
    orderId: string;
    idempotencyKey: string;
  }) {
    const t = await this.stripe.transfers.create(
      {
        amount: i.amountCents,
        currency: i.currency.toLowerCase(),
        destination: i.destination,
        source_transaction: i.sourceTransaction,
        transfer_group: i.transferGroup,
        metadata: { orderId: i.orderId },
      },
      { idempotencyKey: i.idempotencyKey },
    );
    return { id: t.id };
  }

  async refund(i: {
    paymentIntentId: string;
    amountCents: number;
    orderId: string;
    idempotencyKey: string;
  }) {
    const r = await this.stripe.refunds.create(
      {
        payment_intent: i.paymentIntentId,
        amount: i.amountCents,
        metadata: { orderId: i.orderId },
      },
      { idempotencyKey: i.idempotencyKey },
    );
    return { id: r.id };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ParsedWebhook {
    let e: Stripe.Event;
    try {
      e = this.stripe.webhooks.constructEvent(rawBody, signature ?? '', this.webhookSecret);
    } catch (err) {
      throw new InvalidWebhookSignatureError(String(err));
    }
    return { id: e.id, type: e.type, event: normalise(e), raw: e };
  }
}

function normalise(e: Stripe.Event): PaymentEvent {
  switch (e.type) {
    case 'payment_intent.succeeded': {
      const pi = e.data.object;
      return {
        kind: 'payment.succeeded',
        paymentIntentId: pi.id,
        chargeId:
          typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? ''),
        amountCents: pi.amount_received,
        currency: pi.currency,
        orderId: pi.metadata.orderId ?? null,
      };
    }
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      const pi = e.data.object;
      return {
        kind: e.type === 'payment_intent.canceled' ? 'payment.canceled' : 'payment.failed',
        paymentIntentId: pi.id,
        orderId: pi.metadata.orderId ?? null,
      };
    }
    case 'account.updated':
      return { kind: 'account.updated', accountId: e.data.object.id };
    case 'charge.dispute.created': {
      const d = e.data.object;
      return {
        kind: 'dispute.created',
        disputeId: d.id,
        chargeId: typeof d.charge === 'string' ? d.charge : d.charge.id,
        amountCents: d.amount,
        reason: d.reason,
        evidenceDueBy: d.evidence_details?.due_by
          ? new Date(d.evidence_details.due_by * 1000)
          : null,
      };
    }
    case 'transfer.reversed':
      return { kind: 'transfer.reversed', transferId: e.data.object.id };
    default:
      return { kind: 'ignored' };
  }
}
