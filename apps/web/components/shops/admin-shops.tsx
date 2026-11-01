'use client';
import type { AdminShopItem, ShopStatus } from '@accordo/shared';
import { Alert, Button, cn, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

const STATUSES: ShopStatus[] = ['PENDING', 'REJECTED', 'VERIFIED'];

/** Staff queue: shop applications to verify (SPEC §3.10). */
export function AdminShops() {
  const t = useTranslations('Shops');
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<ShopStatus>('PENDING');
  const { data, error } = useQuery({
    queryKey: ['admin-shops', status],
    queryFn: () => api.get<AdminShopItem[]>(`/api/v1/admin/shops?status=${status}`),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('adminTitle')}</h1>
      <div role="tablist" aria-label={t('adminTitle')} className="flex flex-wrap gap-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              status === s ? 'bg-accent font-medium' : 'hover:bg-accent',
            )}
            onClick={() => setStatus(s)}
          >
            {t(`statusTab.${s}`)}
          </button>
        ))}
      </div>
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {data && !data.length ? <p className="text-muted-foreground">{t('queueEmpty')}</p> : null}
      <ul className="grid gap-4">
        {data?.map((s) => (
          <li key={s.id}>
            <ShopReview shop={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShopReview({ shop: s }: { shop: AdminShopItem }) {
  const t = useTranslations('Shops');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (path: 'verify' | 'reject') => {
    setError(null);
    try {
      await api.post(`/api/v1/admin/shops/${s.id}/${path}`, path === 'reject' ? { reason } : {});
      await qc.invalidateQueries({ queryKey: ['admin-shops'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const rows: Array<[string, string | null]> = [
    [t('fields.legalName'), s.legalName],
    [t('fields.vatNumber'), s.vatNumber],
    [t('fields.reaNumber'), s.reaNumber],
    [
      t('fields.addressLine'),
      `${s.addressLine}, ${s.cap} ${s.comune.name} (${s.comune.provinciaSigla})`,
    ],
    [t('fields.email'), s.email],
    [t('fields.phone'), s.phone],
    [t('fields.pec'), s.pec],
    [t('fields.website'), s.website],
    [t('fields.returnPolicy'), s.returnPolicy],
    [t('fields.warrantyInfo'), s.warrantyInfo],
  ];
  return (
    <article className="grid gap-3 rounded-xl border p-4 text-sm">
      <p className="font-semibold">
        {s.name}{' '}
        <span className="font-normal text-muted-foreground">
          · {s.owner.email}
          {s.owner.username ? ` (@${s.owner.username})` : ''} ·{' '}
          {format.dateTime(new Date(s.createdAt), { dateStyle: 'medium' })}
        </span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) =>
          v ? (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="whitespace-pre-line">{v}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {s.rejectionReason ? (
        <p>
          {t('reason')}: {s.rejectionReason}
        </p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-2 rounded-lg bg-muted p-3">
        <Label htmlFor={`${id}-r`}>{t('rejectReason')}</Label>
        <Textarea
          id={`${id}-r`}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          {s.status !== 'VERIFIED' ? (
            <Button size="sm" onClick={() => act('verify')}>
              {t('verify')}
            </Button>
          ) : null}
          {s.status !== 'REJECTED' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={reason.trim().length < 20}
              onClick={() => act('reject')}
            >
              {s.status === 'VERIFIED' ? t('revoke') : t('reject')}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
