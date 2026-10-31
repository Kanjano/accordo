'use client';
import type { Address, CheckoutResponse, DeliveryMethodCode } from '@accordo/shared';
import { Alert, Button, buttonVariants, Label } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

/** "Compra con pagamento protetto" (SPEC §6.5): delivery choice, address, then the checkout page. */
export function BuyBox({
  listingId,
  priceCents,
  selfShippingPriceCents,
  methods,
  offerId,
}: {
  listingId: string;
  priceCents: number;
  selfShippingPriceCents: number | null;
  methods: DeliveryMethodCode[];
  /** Accepted offer being paid (price agreed in the chat). */
  offerId?: string;
}) {
  const t = useTranslations('Checkout');
  const errorMessage = useErrorMessage();
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [method, setMethod] = useState<DeliveryMethodCode | null>(methods[0] ?? null);
  const [addressId, setAddressId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: addresses = [] } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get<Address[]>('/api/v1/me/addresses'),
    enabled: !!session && method === 'SHIPPING_SELF',
  });
  const shipping = addresses.filter((a) => a.type === 'SHIPPING');
  const chosen = addressId || shipping.find((a) => a.isDefault)?.id || shipping[0]?.id || '';

  if (isPending || !methods.length) return null;
  if (!session)
    return (
      <Link href={`/accedi?next=${encodeURIComponent(pathname)}`} className={buttonVariants()}>
        <ShieldCheck aria-hidden />
        {t('signInToBuy')}
      </Link>
    );

  async function buy() {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<CheckoutResponse>('/api/v1/orders', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        json: {
          listingId,
          deliveryMethod: method,
          ...(method === 'SHIPPING_SELF' ? { addressId: chosen } : {}),
          ...(offerId ? { offerId } : {}),
        },
      });
      router.push(`/checkout/${res.orderId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-3 rounded-xl border border-emerald-600/40 p-4"
    >
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold">
        <ShieldCheck aria-hidden className="size-5 text-emerald-700" />
        {t('title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('protection')}</p>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1 font-medium">{t('delivery')}</legend>
        {methods.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-method`}
              className="size-4 accent-primary"
              checked={method === m}
              onChange={() => setMethod(m)}
            />
            {t(`method.${m}`)}
            {m === 'SHIPPING_SELF' && selfShippingPriceCents
              ? ` · ${formatPrice(selfShippingPriceCents)}`
              : ''}
          </label>
        ))}
      </fieldset>
      {method === 'SHIPPING_SELF' ? (
        shipping.length ? (
          <div className="grid gap-1 text-sm">
            <Label htmlFor={`${id}-address`}>{t('address')}</Label>
            <select
              id={`${id}-address`}
              value={chosen}
              onChange={(e) => setAddressId(e.target.value)}
              className="h-10 rounded-md border bg-background px-3"
            >
              {shipping.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}, {a.line1}, {a.cap}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <Alert>
            {t('noAddress')}{' '}
            <Link href="/account/impostazioni/indirizzi" className="underline">
              {t('addAddress')}
            </Link>
          </Alert>
        )
      ) : null}
      {method === 'HAND_DELIVERY' ? <p className="text-sm">{t('handoverHint')}</p> : null}
      <p className="text-sm">
        {t('price', { price: formatPrice(priceCents) })} {t('feeAtCheckout')}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button onClick={buy} disabled={busy || !method || (method === 'SHIPPING_SELF' && !chosen)}>
        {t('buy')}
      </Button>
    </section>
  );
}
