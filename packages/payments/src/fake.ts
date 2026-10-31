import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type ConnectedAccountStatus,
  InvalidWebhookSignatureError,
  type ParsedWebhook,
  type PaymentEvent,
  type PaymentProvider,
} from './port.js';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
const id = (prefix: string, key: string) =>
  `${prefix}_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;

/** HMAC of the raw body, as sent in `x-fake-signature`. */
export function signFakeWebhook(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** A fake provider event, ready to be POSTed (signed) to the webhook endpoint. */
export function fakeWebhookBody(event: PaymentEvent): string {
  return JSON.stringify({ id: `evt_fake_${randomUUID()}`, type: event.kind, event });
}

/**
 * Development and test adapter (ADR-0037): no network, ids derived from the idempotency keys (so a
 * retry returns the same object), events delivered through the real webhook path, signed with HMAC.
 * Payment outcomes are simulated by the API's development endpoints.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;

  constructor(private readonly secret: string) {}

  async createConnectedAccount(i: { userId: string }) {
    return { accountId: `fake_acct_${i.userId}` };
  }

  async onboardingLink(_accountId: string, urls: { returnUrl: string }) {
    return { url: `${urls.returnUrl}${urls.returnUrl.includes('?') ? '&' : '?'}fake-onboarding=1` };
  }

  async accountStatus(): Promise<ConnectedAccountStatus> {
    return {
      transfersEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirements: { currently_due: [] },
      disabledReason: null,
    };
  }

  async createPaymentIntent(i: { idempotencyKey: string }) {
    const pi = id('fake_pi', i.idempotencyKey);
    return { id: pi, clientSecret: `${pi}_secret_fake` };
  }

  async cancelPaymentIntent() {}

  /** No processor fee in fake mode (the ledger simply has no fee transaction). */
  async processorFee(): Promise<number | null> {
    return null;
  }

  async createTransfer(i: { idempotencyKey: string }) {
    return { id: id('fake_tr', i.idempotencyKey) };
  }

  async refund(i: { idempotencyKey: string }) {
    return { id: id('fake_re', i.idempotencyKey) };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ParsedWebhook {
    const expected = Buffer.from(signFakeWebhook(rawBody.toString('utf8'), this.secret), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new InvalidWebhookSignatureError('Invalid fake webhook signature');
    const body = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      type: string;
      event: PaymentEvent;
    };
    if (body.event.kind === 'dispute.created' && body.event.evidenceDueBy)
      body.event.evidenceDueBy = new Date(body.event.evidenceDueBy);
    return { id: body.id, type: body.type, event: body.event, raw: body };
  }
}
