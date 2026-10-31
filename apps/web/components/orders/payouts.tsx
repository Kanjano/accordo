'use client';
import type { BalanceDto, PaymentAccountDto } from '@accordo/shared';
import { Alert, Button } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

type Account = PaymentAccountDto | { provider: null };

/** "Incassi" (SPEC §6.2): protected-payment onboarding and the balance from the ledger. */
export function Payouts() {
  const t = useTranslations('Payouts');
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { data: account } = useQuery({
    queryKey: ['payment-account'],
    queryFn: () => api.get<Account>('/api/v1/payments/account'),
    refetchInterval: (q) =>
      q.state.data && 'transfersEnabled' in q.state.data && q.state.data.transfersEnabled
        ? false
        : 3000,
  });
  const { data: balance } = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.get<BalanceDto>('/api/v1/me/balance'),
  });

  // Fake provider (development): returning from the simulated onboarding completes it.
  const fakeReturn = params.get('fake-onboarding') === '1';
  useEffect(() => {
    if (!fakeReturn) return;
    void api
      .post('/api/v1/dev/payments/onboarding-complete')
      .then(() => qc.invalidateQueries({ queryKey: ['payment-account'] }));
  }, [fakeReturn, qc]);

  async function onboard() {
    setError(null);
    try {
      const { url } = await withStepUp(() =>
        api.post<{ url: string }>('/api/v1/payments/onboarding'),
      );
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const enabled = !!account && 'transfersEnabled' in account && account.transfersEnabled;
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <section aria-labelledby="account" className="grid gap-3 rounded-xl border p-4">
        <h2 id="account" className="font-semibold">
          {t('accountTitle')}
        </h2>
        {enabled ? (
          <Alert tone="success">{t('enabled')}</Alert>
        ) : (
          <>
            <p className="text-sm">{t('intro')}</p>
            {account && 'disabledReason' in account && account.disabledReason ? (
              <Alert>{t('restricted')}</Alert>
            ) : null}
            <Button className="justify-self-start" onClick={onboard}>
              {account?.provider ? t('continue') : t('activate')}
            </Button>
          </>
        )}
        {error ? <Alert tone="error">{error}</Alert> : null}
      </section>
      {balance ? (
        <section aria-labelledby="balance" className="grid gap-3">
          <h2 id="balance" className="font-semibold">
            {t('balanceTitle')}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['held', balance.heldCents],
                ['scheduled', balance.scheduledCents],
                ['transferred', balance.transferredCents],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl border p-4">
                <dt className="text-sm text-muted-foreground">{t(k)}</dt>
                <dd className="text-2xl font-semibold">{formatPrice(v)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">{t('payoutsNote')}</p>
        </section>
      ) : null}
    </div>
  );
}
