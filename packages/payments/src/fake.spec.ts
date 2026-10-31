import { describe, expect, it } from 'vitest';
import { FakePaymentProvider, fakeWebhookBody, signFakeWebhook } from './fake.js';
import { InvalidWebhookSignatureError } from './port.js';

describe('FakePaymentProvider', () => {
  const provider = new FakePaymentProvider('secret');

  it('returns the same object for the same idempotency key', async () => {
    const a = await provider.createPaymentIntent({ idempotencyKey: 'pi:1' } as never);
    expect(await provider.createPaymentIntent({ idempotencyKey: 'pi:1' } as never)).toEqual(a);
    expect((await provider.createTransfer({ idempotencyKey: 'transfer:1' } as never)).id).toMatch(
      /^fake_tr_/,
    );
  });

  it('accepts only correctly signed webhooks', () => {
    const body = fakeWebhookBody({ kind: 'account.updated', accountId: 'fake_acct_1' });
    const parsed = provider.parseWebhook(Buffer.from(body), signFakeWebhook(body, 'secret'));
    expect(parsed.event).toEqual({ kind: 'account.updated', accountId: 'fake_acct_1' });
    expect(() => provider.parseWebhook(Buffer.from(body), signFakeWebhook(body, 'other'))).toThrow(
      InvalidWebhookSignatureError,
    );
    expect(() => provider.parseWebhook(Buffer.from(body), undefined)).toThrow(
      InvalidWebhookSignatureError,
    );
  });
});
