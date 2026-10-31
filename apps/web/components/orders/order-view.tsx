'use client';
import {
  CARRIERS,
  type OrderAmountsDto,
  type OrderDetail,
  type OrderSummary,
} from '@accordo/shared';
import { Alert, Button, buttonVariants, Input, Label } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useId, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

export function Amounts({
  amounts: a,
  side,
}: {
  amounts: OrderAmountsDto;
  side: 'BUYER' | 'SELLER';
}) {
  const t = useTranslations('Orders');
  const rows: Array<[string, number]> =
    side === 'BUYER'
      ? [
          [t('item'), a.itemPriceCents],
          [t('shipping'), a.shippingPriceCents],
          [t('fee'), a.buyerFeeCents],
        ]
      : [
          [t('item'), a.itemPriceCents],
          [t('shippingToYou'), a.sellerNetCents - a.itemPriceCents],
        ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows
        .filter(([, v]) => v > 0)
        .map(([label, v]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{formatPrice(v)}</dd>
          </div>
        ))}
      <dt className="font-semibold">{side === 'BUYER' ? t('total') : t('net')}</dt>
      <dd className="text-right font-semibold">
        {formatPrice(side === 'BUYER' ? a.totalCents : a.sellerNetCents)}
      </dd>
      {a.refundedCents ? (
        <>
          <dt className="text-muted-foreground">{t('refunded')}</dt>
          <dd className="text-right">{formatPrice(a.refundedCents)}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function OrderList({ side }: { side: 'buyer' | 'seller' }) {
  const t = useTranslations('Orders');
  const ts = useTranslations('OrderStatus');
  const format = useFormatter();
  const { data } = useQuery({
    queryKey: ['orders', side],
    queryFn: () => api.get<OrderSummary[]>(`/api/v1/me/orders?role=${side}`),
  });
  const base = side === 'buyer' ? '/account/acquisti' : '/account/vendite';
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{side === 'buyer' ? t('purchases') : t('sales')}</h1>
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-2">
        {data?.map((o) => (
          <li key={o.id}>
            <Link
              href={`${base}/${o.id}`}
              className="grid gap-1 rounded-xl border p-3 text-sm hover:bg-accent sm:grid-cols-[1fr_auto]"
            >
              <span className="font-medium">{o.listing.title}</span>
              <span className="font-semibold">
                {formatPrice(side === 'buyer' ? o.totalCents : o.sellerNetCents)}
              </span>
              <span className="text-muted-foreground">
                {o.number} · {format.dateTime(new Date(o.createdAt), { dateStyle: 'medium' })} ·{' '}
                {o.counterpart.name}
              </span>
              <span className="w-fit rounded-full bg-secondary px-2 py-0.5 text-xs">
                {ts(o.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrderView({ id }: { id: string }) {
  const t = useTranslations('Orders');
  const ts = useTranslations('OrderStatus');
  const te = useTranslations('OrderEvent');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const withStepUp = useStepUp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const { data: o, error: loadError } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/api/v1/orders/${id}`),
    // Webhook-driven changes (payment, transfer) land within seconds.
    refetchInterval: (q) => (q.state.data?.status === 'CHECKOUT_PENDING' ? 2000 : 15_000),
  });
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      if (updated && typeof updated === 'object' && 'status' in updated)
        qc.setQueryData(['order', id], updated);
      else await qc.invalidateQueries({ queryKey: ['order', id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body: object = {}) =>
    api.post<OrderDetail>(`/api/v1/orders/${id}/${path}`, body);

  if (loadError) return <Alert tone="error">{errorMessage(loadError)}</Alert>;
  if (!o) return <p className="text-muted-foreground">{t('loading')}</p>;
  const can = (a: OrderDetail['actions'][number]) => o.actions.includes(a);

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="text-sm text-muted-foreground">{t('numberLabel', { number: o.number })}</p>
        <h1 className="text-2xl font-bold">{o.listing.title}</h1>
        <p className="w-fit rounded-full bg-secondary px-3 py-1 text-sm font-medium" role="status">
          {ts(o.status)}
        </p>
        <p className="text-sm">
          {o.role === 'BUYER' ? t('seller') : t('buyer')}: {o.counterpart.name} ·{' '}
          {t(`method.${o.deliveryMethod}`)}
        </p>
      </header>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <section aria-labelledby="next" className="grid gap-3 rounded-xl border p-4">
        <h2 id="next" className="font-semibold">
          {t('nextStep')}
        </h2>
        <p className="text-sm">{t(`hint.${o.role}.${o.status}` as 'hint.BUYER.PAID')}</p>
        {o.deadlines.shipBy && o.status === 'PAID' ? (
          <p className="text-sm">{t('shipBy', { date: date(o.deadlines.shipBy) })}</p>
        ) : null}
        {o.deadlines.autoCompleteAt && ['SHIPPED', 'DELIVERED'].includes(o.status) ? (
          <p className="text-sm">{t('autoComplete', { date: date(o.deadlines.autoCompleteAt) })}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {can('pay') ? (
            <Link href={`/checkout/${o.id}`} className={buttonVariants()}>
              {t('pay')}
            </Link>
          ) : null}
          {can('confirmReceipt') ? (
            <Button
              disabled={busy}
              onClick={() =>
                window.confirm(t('confirmReceiptWarning')) &&
                run(() =>
                  withStepUp(() =>
                    api.request<OrderDetail>(`/api/v1/orders/${id}/confirm-receipt`, {
                      method: 'POST',
                      headers: { 'idempotency-key': `confirm-${id}` },
                    }),
                  ),
                )
              }
            >
              {t('confirmReceipt')}
            </Button>
          ) : null}
          {can('showHandoverCode') && !code ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setCode(
                    (
                      await withStepUp(() =>
                        api.get<{ code: string }>(`/api/v1/orders/${id}/handover-code`),
                      )
                    ).code,
                  ),
                )
              }
            >
              {t('showCode')}
            </Button>
          ) : null}
          {can('cancel') ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => window.confirm(t('cancelConfirm')) && run(() => post('cancel'))}
            >
              {t('cancel')}
            </Button>
          ) : null}
          {can('requestCancel') ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => post('cancel-requests'))}
            >
              {t('requestCancel')}
            </Button>
          ) : null}
          {can('acceptCancel') ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(() => post('cancel-requests/accept'))}
            >
              {t('acceptCancel')}
            </Button>
          ) : null}
        </div>
        {o.cancelRequest ? (
          <p className="text-sm text-muted-foreground">
            {o.cancelRequest.byMe ? t('cancelRequestedByMe') : t('cancelRequestedByOther')}
          </p>
        ) : null}
        {code ? (
          <div className="grid justify-items-start gap-2 rounded-lg bg-muted p-4">
            <p className="text-sm font-medium">{t('codeWarning')}</p>
            <p className="font-mono text-4xl tracking-[0.3em]">
              <span aria-hidden>{code}</span>
              {/* Read digit by digit by screen readers. */}
              <span className="sr-only">{t('codeLabel', { code: code.split('').join(' ') })}</span>
            </p>
            <QRCodeSVG value={code} size={128} title={t('qrTitle')} />
          </div>
        ) : null}
        {can('ship') ? (
          <ShipForm onSubmit={(body) => run(() => post('ship', body))} busy={busy} />
        ) : null}
        {can('verifyHandover') ? (
          <HandoverForm
            lockedTill={o.handoverLockedTill}
            busy={busy}
            onSubmit={(c) => run(() => post('handover/verify', { code: c }))}
          />
        ) : null}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="amounts" className="grid content-start gap-2">
          <h2 id="amounts" className="font-semibold">
            {t('amounts')}
          </h2>
          <Amounts amounts={o.amounts} side={o.role} />
          {o.role === 'SELLER' ? (
            <p className="text-sm text-muted-foreground">
              {t(`payout.${o.payoutStatus}` as 'payout.NOT_DUE')}
            </p>
          ) : null}
        </section>
        {o.shippingAddress ? (
          <section aria-labelledby="address" className="grid content-start gap-1 text-sm">
            <h2 id="address" className="font-semibold">
              {t('shippingAddress')}
            </h2>
            <p>{o.shippingAddress.fullName}</p>
            <p>{o.shippingAddress.line1}</p>
            {o.shippingAddress.line2 ? <p>{o.shippingAddress.line2}</p> : null}
            <p>
              {o.shippingAddress.cap} {o.shippingAddress.comune} ({o.shippingAddress.provincia})
            </p>
            <p>{o.shippingAddress.phone}</p>
          </section>
        ) : null}
      </div>

      {o.shipments.length ? (
        <section aria-labelledby="tracking" className="grid gap-1 text-sm">
          <h2 id="tracking" className="font-semibold">
            {t('tracking')}
          </h2>
          {o.shipments.map((s) => (
            <p key={`${s.carrier}-${s.trackingNumber}`}>
              {s.carrier} · <span className="font-mono">{s.trackingNumber}</span>
            </p>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="timeline" className="grid gap-2">
        <h2 id="timeline" className="font-semibold">
          {t('timeline')}
        </h2>
        <ol className="grid gap-2 border-l pl-4 text-sm">
          {o.timeline.map((e) => (
            <li key={`${e.at}-${e.event}`}>
              <time className="text-muted-foreground" dateTime={e.at}>
                {date(e.at)}
              </time>{' '}
              ·{' '}
              {te.has(e.event as 'PAYMENT_SUCCEEDED')
                ? te(e.event as 'PAYMENT_SUCCEEDED')
                : e.event}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ShipForm({
  onSubmit,
  busy,
}: {
  onSubmit: (b: { carrier: string; trackingNumber: string }) => void;
  busy: boolean;
}) {
  const t = useTranslations('Orders');
  const id = useId();
  const [carrier, setCarrier] = useState<string>(CARRIERS[0]);
  const [tracking, setTracking] = useState('');
  return (
    <form
      className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ carrier, trackingNumber: tracking });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`${id}-c`}>{t('carrier')}</Label>
        <select
          id={`${id}-c`}
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          className="h-10 rounded-md border bg-background px-3"
        >
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-t`}>{t('trackingNumber')}</Label>
        <Input
          id={`${id}-t`}
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={busy || tracking.trim().length < 8}>
        {t('markShipped')}
      </Button>
    </form>
  );
}

function HandoverForm({
  onSubmit,
  busy,
  lockedTill,
}: {
  onSubmit: (code: string) => void;
  busy: boolean;
  lockedTill: string | null;
}) {
  const t = useTranslations('Orders');
  const id = useId();
  const [code, setCode] = useState('');
  const locked = !!lockedTill && Date.parse(lockedTill) > Date.now();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(code);
      }}
    >
      <p className="text-sm">{t('handoverSellerHint')}</p>
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={id}>{t('handoverCode')}</Label>
          <Input
            id={id}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="max-w-32 font-mono tracking-widest"
          />
        </div>
        <Button type="submit" disabled={busy || locked || code.length !== 6}>
          {t('verify')}
        </Button>
      </div>
      {locked ? <p className="text-sm text-destructive">{t('locked')}</p> : null}
    </form>
  );
}
