'use client';
import type { OrderDetail, OrderSummary } from '@accordo/shared';
import { Alert, Input, Label } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

type AdminOrder = OrderSummary & {
  buyer: { name: string };
  seller: { name: string };
  payoutStatus: string;
};

/** Back-office order view (SPEC §3.10): search, status, timeline. Staff with 2FA only. */
export function AdminOrders() {
  const t = useTranslations('AdminOrders');
  const ts = useTranslations('OrderStatus');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ['admin-orders', q],
    queryFn: () => api.get<AdminOrder[]>(`/api/v1/admin/orders?q=${encodeURIComponent(q)}`),
  });
  const { data: detail } = useQuery({
    queryKey: ['admin-order', selected],
    queryFn: () => api.get<OrderDetail>(`/api/v1/admin/orders/${selected}`),
    enabled: !!selected,
  });
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <div className="grid max-w-sm gap-1">
        <Label htmlFor="order-search">{t('search')}</Label>
        <Input
          id="order-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="26-…"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">{t('number')}</th>
              <th className="p-2">{t('status')}</th>
              <th className="p-2">{t('parties')}</th>
              <th className="p-2">{t('total')}</th>
              <th className="p-2">{t('payout')}</th>
              <th className="p-2">{t('created')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="p-2">
                  <button
                    type="button"
                    className="font-mono underline"
                    onClick={() => setSelected(o.id)}
                  >
                    {o.number}
                  </button>
                </td>
                <td className="p-2">{ts(o.status)}</td>
                <td className="p-2">
                  {o.buyer.name} → {o.seller.name}
                </td>
                <td className="p-2">{formatPrice(o.totalCents)}</td>
                <td className="p-2">{o.payoutStatus}</td>
                <td className="p-2">
                  {format.dateTime(new Date(o.createdAt), { dateStyle: 'short' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? (
        <section
          aria-labelledby="admin-detail"
          className="grid gap-2 rounded-xl border p-4 text-sm"
        >
          <h2 id="admin-detail" className="font-semibold">
            {detail.number} · {detail.listing.title}
          </h2>
          <ol className="grid gap-1">
            {detail.timeline.map((e) => (
              <li key={`${e.at}-${e.event}`}>
                {format.dateTime(new Date(e.at), { dateStyle: 'short', timeStyle: 'medium' })} ·{' '}
                {e.event} → {e.toStatus} ({e.actorRole})
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
