'use client';
import { DISPUTE_OUTCOMES, type DisputeDetail, type DisputeOutcomeCode } from '@accordo/shared';
import { Alert, Button, Checkbox, Input, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { parseEuroToCents } from '@/lib/price';
import { useErrorMessage } from '@/lib/use-error-message';
import { DisputePanel } from './dispute';

interface Row {
  id: string;
  orderNumber: string;
  totalCents: number;
  reason: string;
  status: string;
  escalatedAt: string | null;
  appealPending: boolean;
  createdAt: string;
}

/** Back-office disputes (SPEC §3.10, §6.6): queue, written decisions, appeals. */
export function AdminDisputes() {
  const t = useTranslations('Disputes');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState('UNDER_REVIEW');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ['admin-disputes', status],
    queryFn: () => api.get<Row[]>(`/api/v1/admin/disputes${status ? `?status=${status}` : ''}`),
  });
  const { data: detail } = useQuery({
    queryKey: ['dispute', selected],
    queryFn: () => api.get<DisputeDetail>(`/api/v1/admin/disputes/${selected}`),
    enabled: !!selected,
  });
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('adminTitle')}</h1>
      <div className="grid max-w-xs gap-1">
        <Label htmlFor="dispute-status">{t('statusFilter')}</Label>
        <select
          id="dispute-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border bg-background px-3"
        >
          <option value="">{t('all')}</option>
          {[
            'OPEN',
            'AWAITING_BUYER',
            'UNDER_REVIEW',
            'AWAITING_RETURN',
            'RESOLVED',
            'WITHDRAWN',
          ].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s as 'OPEN'}`)}
            </option>
          ))}
        </select>
      </div>
      <ul className="grid gap-2 text-sm">
        {data?.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className="w-full rounded-lg border p-3 text-left hover:bg-accent"
              onClick={() => setSelected(d.id)}
            >
              <span className="font-mono">{d.orderNumber}</span> ·{' '}
              {t(`reason.${d.reason as 'OTHER'}`)} · {formatPrice(d.totalCents)} ·{' '}
              {t(`status.${d.status as 'OPEN'}`)} ·{' '}
              {format.dateTime(new Date(d.createdAt), { dateStyle: 'short' })}
              {d.appealPending ? ` · ${t('appealPending')}` : ''}
            </button>
          </li>
        ))}
      </ul>
      {selected && detail ? (
        <div className="grid gap-4">
          <DisputePanel disputeId={selected} admin />
          {detail.status === 'UNDER_REVIEW' ? <ResolveForm dispute={detail} /> : null}
          {detail.appealedAt && !detail.appealResolvedAt ? <AppealForm dispute={detail} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ResolveForm({ dispute: d }: { dispute: DisputeDetail }) {
  const t = useTranslations('Disputes');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [outcome, setOutcome] = useState<DisputeOutcomeCode>('REFUND_FULL');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [fault, setFault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/v1/admin/disputes/${d.id}/resolve`, {
        outcome,
        notes,
        sellerAtFault: fault,
        ...(outcome === 'REFUND_PARTIAL' ? { refundCents: parseEuroToCents(amount) } : {}),
      });
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border p-4">
      <h2 className="font-semibold">{t('decide')}</h2>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 font-medium">{t('outcomeLabel')}</legend>
        {DISPUTE_OUTCOMES.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-o`}
              className="size-4 accent-primary"
              checked={outcome === o}
              onChange={() => setOutcome(o)}
            />
            {t(`outcome.${o}`)}
          </label>
        ))}
      </fieldset>
      {outcome === 'REFUND_PARTIAL' ? (
        <div className="grid gap-1">
          <Label htmlFor={`${id}-a`}>{t('amount', { max: formatPrice(d.itemPriceCents) })}</Label>
          <Input
            id={`${id}-a`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="max-w-40"
          />
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={fault} onChange={(e) => setFault(e.target.checked)} />
        {t('sellerAtFault')}
      </label>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-n`}>{t('motivationLabel')}</Label>
        <Textarea
          id={`${id}-n`}
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" className="justify-self-start" disabled={notes.trim().length < 20}>
        {t('confirmDecision')}
      </Button>
    </form>
  );
}

function AppealForm({ dispute: d }: { dispute: DisputeDetail }) {
  const t = useTranslations('Disputes');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = async (upheld: boolean) => {
    setError(null);
    try {
      await api.post(`/api/v1/admin/disputes/${d.id}/appeal-decision`, { upheld, notes });
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="grid gap-3 rounded-xl border p-4">
      <h2 className="font-semibold">{t('appealReview')}</h2>
      <p className="text-sm text-muted-foreground">{t('appealReviewHint')}</p>
      <Label htmlFor={`${id}-n`}>{t('motivationLabel')}</Label>
      <Textarea id={`${id}-n`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button disabled={notes.trim().length < 20} onClick={() => decide(true)}>
          {t('uphold')}
        </Button>
        <Button variant="outline" disabled={notes.trim().length < 20} onClick={() => decide(false)}>
          {t('overturn')}
        </Button>
      </div>
    </div>
  );
}
