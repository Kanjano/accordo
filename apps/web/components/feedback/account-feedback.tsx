'use client';
import type {
  FeedbackItem,
  FeedbackRatingCode,
  PendingFeedback,
  RevisionRequestItem,
} from '@accordo/shared';
import { Alert, Button, buttonVariants, cn, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { FeedbackEntry } from './feedback-entry';
import { StarsInput } from './stars';

const TABS = ['pending', 'received', 'left', 'revisions'] as const;
type Tab = (typeof TABS)[number];

/** "Il mio account → Feedback" (SPEC §8.9). */
export function AccountFeedback({ initialOrder }: { initialOrder?: string }) {
  const t = useTranslations('Feedback');
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-1">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              tab === k ? 'bg-accent font-medium' : 'hover:bg-accent',
            )}
            onClick={() => setTab(k)}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'pending' ? <Pending initialOrder={initialOrder} /> : null}
        {tab === 'received' ? <List kind="received" /> : null}
        {tab === 'left' ? <List kind="left" /> : null}
        {tab === 'revisions' ? <Revisions /> : null}
      </div>
    </div>
  );
}

function Pending({ initialOrder }: { initialOrder?: string }) {
  const t = useTranslations('Feedback');
  const format = useFormatter();
  const { data } = useQuery({
    queryKey: ['feedback-pending'],
    queryFn: () => api.get<PendingFeedback[]>('/api/v1/me/feedback/pending'),
  });
  const [open, setOpen] = useState<string | null>(initialOrder ?? null);
  if (data && !data.length) return <p className="text-muted-foreground">{t('nothingPending')}</p>;
  return (
    <ul className="grid gap-3">
      {data?.map((p) => (
        <li key={p.orderId} className="grid gap-2 rounded-xl border p-4">
          <p className="font-medium">{p.listingTitle}</p>
          <p className="text-sm text-muted-foreground">
            {t(p.role === 'BUYER_TO_SELLER' ? 'forSeller' : 'forBuyer', { name: p.counterpart })} ·{' '}
            {t('deadline', {
              date: format.dateTime(new Date(p.deadline), { dateStyle: 'medium' }),
            })}
          </p>
          {open === p.orderId ? (
            <LeaveFeedback pending={p} onDone={() => setOpen(null)} />
          ) : (
            <Button size="sm" className="justify-self-start" onClick={() => setOpen(p.orderId)}>
              {t('leave')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function LeaveFeedback({ pending: p, onDone }: { pending: PendingFeedback; onDone: () => void }) {
  const t = useTranslations('Feedback');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const sellerSide = p.role === 'SELLER_TO_BUYER';
  const hand = p.deliveryMethod === 'HAND_DELIVERY';
  const [rating, setRating] = useState<FeedbackRatingCode>('POSITIVE');
  const [comment, setComment] = useState('');
  const [dsr, setDsr] = useState<Record<string, number | null>>({
    itemAsDescribed: null,
    communication: null,
    shippingTime: null,
    packaging: null,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criteria = sellerSide ? [] : hand ? ['itemAsDescribed', 'communication'] : Object.keys(dsr);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // SPEC §8.1: before a neutral or negative, suggest talking to the other party first.
    if (rating !== 'POSITIVE' && !confirmed) {
      setConfirmed(true);
      return;
    }
    setError(null);
    try {
      await api.post(`/api/v1/orders/${p.orderId}/feedback`, {
        rating,
        ...(comment.trim() ? { comment } : {}),
        ...(sellerSide ? {} : { dsr: Object.fromEntries(criteria.map((k) => [k, dsr[k]])) }),
      });
      await qc.invalidateQueries({ queryKey: ['feedback-pending'] });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 font-medium">{t('overall')}</legend>
        {(sellerSide
          ? (['POSITIVE'] as const)
          : (['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const)
        ).map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-rating`}
              className="size-4 accent-primary"
              checked={rating === r}
              onChange={() => {
                setRating(r);
                setConfirmed(false);
              }}
            />
            {t(`rating.${r}`)}
          </label>
        ))}
        {sellerSide ? (
          <p className="text-xs text-muted-foreground">{t('sellerOnlyPositive')}</p>
        ) : null}
      </fieldset>
      {criteria.map((k) => (
        <StarsInput
          key={k}
          legend={t(`dsr.${k as 'itemAsDescribed'}`)}
          value={dsr[k] ?? null}
          onChange={(v) => setDsr((d) => ({ ...d, [k]: v }))}
        />
      ))}
      <div className="grid gap-1">
        <Label htmlFor={`${id}-comment`}>
          {rating === 'POSITIVE' ? t('commentOptional') : t('commentRequired')}
        </Label>
        <Textarea
          id={`${id}-comment`}
          rows={3}
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t('commentHint', { count: comment.trim().length })}
        </p>
      </div>
      {confirmed ? (
        <Alert>
          {t('tryResolve')}{' '}
          <Link href="/messaggi" className="underline">
            {t('openChat')}
          </Link>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" className="justify-self-start">
        {confirmed ? t('publishAnyway') : t('publish')}
      </Button>
    </form>
  );
}

function List({ kind }: { kind: 'received' | 'left' }) {
  const t = useTranslations('Feedback');
  const { data } = useQuery({
    queryKey: ['my-feedback', kind],
    queryFn: () => api.get<FeedbackItem[]>(`/api/v1/me/feedback?kind=${kind}`),
  });
  if (data && !data.length) return <p className="text-muted-foreground">{t('none')}</p>;
  return (
    <ul className="grid gap-3">
      {data?.map((f) => (
        <li key={f.id}>
          <FeedbackEntry item={f} showStatus queryKey={['my-feedback', kind]} />
        </li>
      ))}
    </ul>
  );
}

function Revisions() {
  const t = useTranslations('Feedback');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState<FeedbackRatingCode>('POSITIVE');
  const { data } = useQuery({
    queryKey: ['revision-requests'],
    queryFn: () => api.get<RevisionRequestItem[]>('/api/v1/me/revision-requests'),
  });
  const answer = async (r: RevisionRequestItem, accept: boolean) => {
    setError(null);
    try {
      const updated = await api.post<RevisionRequestItem[]>(
        `/api/v1/revision-requests/${r.id}/${accept ? 'accept' : 'decline'}`,
        accept ? { rating, ...(comment.trim() ? { comment } : {}) } : {},
      );
      qc.setQueryData(['revision-requests'], updated);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  if (data && !data.length) return <p className="text-muted-foreground">{t('noRevisions')}</p>;
  return (
    <ul className="grid gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {data?.map((r) => (
        <li key={r.id} className="grid gap-2 rounded-xl border p-4 text-sm">
          <p className="font-medium">{r.listingTitle}</p>
          <p>
            {t(`rating.${r.rating}`)} · {r.comment}
          </p>
          <p className="text-muted-foreground">
            {t('revisionMessage')}: {r.message}
          </p>
          <p>{t(`revisionStatus.${r.status}`)}</p>
          {r.mine && r.status === 'PENDING' ? (
            <div className="grid gap-2">
              <fieldset className="flex flex-wrap gap-3">
                <legend className="sr-only">{t('overall')}</legend>
                {(['POSITIVE', 'NEUTRAL'] as const).map((x) => (
                  <label key={x} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`${id}-${r.id}`}
                      className="size-4 accent-primary"
                      checked={rating === x}
                      onChange={() => setRating(x)}
                    />
                    {t(`rating.${x}`)}
                  </label>
                ))}
              </fieldset>
              <Label htmlFor={`${id}-c-${r.id}`}>{t('newComment')}</Label>
              <Textarea
                id={`${id}-c-${r.id}`}
                rows={2}
                maxLength={500}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => answer(r, true)}>
                  {t('acceptRevision')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => answer(r, false)}>
                  {t('declineRevision')}
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
      <li>
        <Link
          href="/come-funzionano-i-feedback"
          className={buttonVariants({ variant: 'link', className: 'px-0' })}
        >
          {t('howItWorks')}
        </Link>
      </li>
    </ul>
  );
}
