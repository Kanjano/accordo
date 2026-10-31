import { FakePaymentProvider } from './fake.js';
import type { PaymentProvider } from './port.js';
import { StripePaymentProvider } from './stripe.js';

export * from './fake.js';
export * from './port.js';
export * from './stripe.js';

export interface PaymentEnv {
  PAYMENT_PROVIDER: 'fake' | 'stripe';
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export function createPaymentProvider(env: PaymentEnv): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY?.startsWith('sk_') || !env.STRIPE_WEBHOOK_SECRET)
      throw new Error('PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  }
  // Fake webhooks are signed with the configured secret (any value works locally).
  return new FakePaymentProvider(env.STRIPE_WEBHOOK_SECRET || 'fake-webhook-secret');
}
