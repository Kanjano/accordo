'use client';
import type { OrderDetail } from '@accordo/shared';
import { Alert, Button, Card, CardContent } from '@accordo/ui';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { Amounts } from './order-view';

// Loaded only when the API uses Stripe: no third-party script with the fake provider.
let stripePromise: ReturnType<typeof loadStripe> | null = null;
const getStripe = () =>
  (stripePromise ??= loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''));

/** SPEC §6.5: Payment Element with Stripe; a simulated payment with the fake provider (ADR-0037). */
export function Checkout({ orderId }: { orderId: string }) {
  const t = useTranslations('Checkout');
  const format = useFormatter();
  const router = useRouter();
  const [waiting, setWaiting] = useState(false);
  const { data: order } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderDetail>(`/api/v1/orders/${orderId}`),
    refetchInterval: waiting ? 1000 : false,
  });
  const { data: payment, error } = useQuery({
    queryKey: ['order-payment', orderId],
    queryFn: () =>
      api.get<{ provider: 'fake' | 'stripe'; clientSecret: string; reservedUntil: string | null }>(
        `/api/v1/orders/${orderId}/payment`,
      ),
    enabled: order?.status === 'CHECKOUT_PENDING',
    retry: false,
  });
  const errorMessage = useErrorMessage();

  // Once the webhook has moved the order on, show it.
  useEffect(() => {
    if (order && order.status !== 'CHECKOUT_PENDING')
      router.replace(`/account/acquisti/${orderId}`);
  }, [order, orderId, router]);

  if (!order) return <p className="text-muted-foreground">{t('loading')}</p>;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <section aria-labelledby="pay" className="grid content-start gap-4">
        <h1 id="pay" className="text-2xl font-bold">
          {t('payTitle')}
        </h1>
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck aria-hidden className="size-4 text-emerald-700" />
          {t('protection')}
        </p>
        {payment?.reservedUntil ? (
          <p className="text-sm text-muted-foreground">
            {t('reservedUntil', {
              time: format.dateTime(new Date(payment.reservedUntil), { timeStyle: 'short' }),
            })}
          </p>
        ) : null}
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
        {waiting ? <Alert>{t('confirming')}</Alert> : null}
        {payment?.provider === 'fake' ? (
          <FakePayment orderId={orderId} onPaid={() => setWaiting(true)} />
        ) : payment && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret: payment.clientSecret, locale: 'it' }}
          >
            <StripePayment orderId={orderId} onPaid={() => setWaiting(true)} />
          </Elements>
        ) : null}
      </section>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <p className="font-medium">{order.listing.title}</p>
          <Amounts amounts={order.amounts} side="BUYER" />
          <p className="text-xs text-muted-foreground">{t('number', { number: order.number })}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FakePayment({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const t = useTranslations('Checkout');
  const [busy, setBusy] = useState(false);
  const send = async (outcome: 'succeeded' | 'failed') => {
    setBusy(true);
    await api.post(`/api/v1/dev/orders/${orderId}/payment`, { outcome });
    onPaid();
  };
  return (
    <div className="grid gap-3 rounded-xl border border-dashed p-4">
      <p className="text-sm">{t('fakeNotice')}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => send('succeeded')}>
          {t('fakePay')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => send('failed')}>
          {t('fakeDecline')}
        </Button>
      </div>
    </div>
  );
}

function StripePayment({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const t = useTranslations('Checkout');
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/account/acquisti/${orderId}` },
      redirect: 'if_required',
    });
    if (err) {
      setError(err.message ?? t('declined'));
      setBusy(false);
    } else onPaid();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <PaymentElement />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" disabled={busy || !stripe}>
        {t('payNow')}
      </Button>
    </form>
  );
}
