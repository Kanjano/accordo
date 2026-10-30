'use client';
import { LISTING_STATUSES, type ListingStatus, type MyListingItem } from '@accordo/shared';
import { Alert, Button, buttonVariants } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatPrice, mediaSrcSet } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

type Action = 'pause' | 'resume' | 'renew' | 'bump' | 'mark-sold' | 'delete';
const ACTIONS: Record<string, Action[]> = {
  ACTIVE: ['bump', 'pause', 'mark-sold', 'renew', 'delete'],
  PAUSED: ['resume', 'mark-sold', 'delete'],
  EXPIRED: ['renew', 'delete'],
  DRAFT: ['delete'],
  PENDING_REVIEW: ['delete'],
  REJECTED: ['delete'],
  SOLD: ['delete'],
};
const ACTION_LABEL: Record<Action, string> = {
  pause: 'pause',
  resume: 'resume',
  renew: 'renew',
  bump: 'bump',
  'mark-sold': 'markSold',
  delete: 'delete',
};
const VISIBLE_STATUSES = LISTING_STATUSES.filter((s) => s !== 'REMOVED');

export function MyListings() {
  const t = useTranslations('MyListings');
  const ts = useTranslations('ListingStatus');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const [status, setStatus] = useState<ListingStatus | ''>('');
  const { data: items } = useQuery({
    queryKey: ['my-listings', status],
    queryFn: () =>
      api.get<MyListingItem[]>(`/api/v1/me/listings${status ? `?status=${status}` : ''}`),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) =>
      action === 'delete'
        ? api.delete(`/api/v1/listings/${id}`)
        : api.post(`/api/v1/listings/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-listings'] }),
  });

  function run(id: string, action: Action) {
    if (action === 'delete' && !window.confirm(t('confirmDelete'))) return;
    if (action === 'mark-sold' && !window.confirm(t('confirmSold'))) return;
    act.mutate({ id, action });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Link href="/vendi" className={buttonVariants()}>
          {t('new')}
        </Link>
      </div>
      <label className="grid max-w-60 gap-2 text-sm font-medium">
        {t('filter')}
        <select
          className="h-10 rounded-md border border-input bg-background px-3 font-normal"
          value={status}
          onChange={(e) => setStatus(e.target.value as ListingStatus | '')}
        >
          <option value="">{t('all')}</option>
          {VISIBLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </select>
      </label>
      {act.isError ? <Alert tone="error">{errorMessage(act.error)}</Alert> : null}
      {items?.length === 0 ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-3">
        {items?.map((l) => (
          <li
            key={l.id}
            className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[8rem_1fr]"
          >
            <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
              {l.imageKey ? (
                // biome-ignore lint/performance/noImgElement: pre-generated variants
                <img
                  {...mediaSrcSet(l.imageKey)}
                  sizes="128px"
                  alt=""
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{l.title}</h2>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {ts(l.status)}
                </span>
              </div>
              <p className="text-sm">
                {formatPrice(l.priceCents)} · {t('views', { count: l.viewsCount })}
                {l.expiresAt && l.status === 'ACTIVE'
                  ? ` · ${t('expires', { date: format.dateTime(new Date(l.expiresAt), { dateStyle: 'medium' }) })}`
                  : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {['ACTIVE', 'SOLD', 'RESERVED'].includes(l.status) ? (
                  <Link
                    href={`/annuncio/${l.slug}-${l.shortId}`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {t('actions.view')}
                  </Link>
                ) : null}
                {!['SOLD', 'RESERVED'].includes(l.status) ? (
                  <Link
                    href={`/account/annunci/${l.id}/modifica`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {l.status === 'DRAFT' ? t('actions.continue') : t('actions.edit')}
                  </Link>
                ) : null}
                {(ACTIONS[l.status] ?? []).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant={a === 'delete' ? 'ghost' : 'outline'}
                    disabled={act.isPending}
                    onClick={() => run(l.id, a)}
                  >
                    {t(`actions.${ACTION_LABEL[a]}` as 'actions.edit')}
                  </Button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
