/** SPEC §5.4: no module calls Stripe directly; everything goes through this port. */
export interface ConnectedAccountStatus {
  transfersEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: unknown;
  disabledReason: string | null;
}

/** Provider events normalised to what the platform reacts to (SPEC §6.10). */
export type PaymentEvent =
  | {
      kind: 'payment.succeeded';
      paymentIntentId: string;
      chargeId: string;
      amountCents: number;
      currency: string;
      orderId: string | null;
    }
  | { kind: 'payment.failed' | 'payment.canceled'; paymentIntentId: string; orderId: string | null }
  | { kind: 'account.updated'; accountId: string }
  | {
      kind: 'dispute.created';
      disputeId: string;
      chargeId: string;
      amountCents: number;
      reason: string;
      evidenceDueBy: Date | null;
    }
  | { kind: 'transfer.reversed'; transferId: string }
  | { kind: 'ignored' };

export interface ParsedWebhook {
  /** Provider event id: the WebhookEvent key that makes processing idempotent. */
  id: string;
  type: string;
  event: PaymentEvent;
  raw: unknown;
}

export class InvalidWebhookSignatureError extends Error {}

export interface PaymentProvider {
  readonly name: 'stripe' | 'fake';
  createConnectedAccount(i: {
    userId: string;
    email: string;
    displayName: string;
  }): Promise<{ accountId: string }>;
  onboardingLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<{ url: string }>;
  accountStatus(accountId: string): Promise<ConnectedAccountStatus>;
  createPaymentIntent(i: {
    amountCents: number;
    currency: string;
    transferGroup: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; clientSecret: string }>;
  cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void>;
  /** Processor fee of a charge, read from its balance transaction (borne by the platform). */
  processorFee(chargeId: string): Promise<number | null>;
  /** Separate charges and transfers: executed by Stripe once the charge funds are available. */
  createTransfer(i: {
    amountCents: number;
    currency: string;
    destination: string;
    sourceTransaction: string;
    transferGroup: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  refund(i: {
    paymentIntentId: string;
    amountCents: number;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  /** Verifies the signature on the raw body, then normalises the event. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): ParsedWebhook;
}
