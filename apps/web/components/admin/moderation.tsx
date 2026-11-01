'use client';
import {
  type AdminAppealItem,
  type AdminListingItem,
  type AdminReportItem,
  MODERATION_REASONS,
  REPORT_DECISIONS,
} from '@accordo/shared';
import { Alert, Button, cn, Input, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';

export function Tabs<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  label: string;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            value === k ? 'bg-accent font-medium' : 'hover:bg-accent',
          )}
          onClick={() => onChange(k)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Reason + statement of reasons, shared by every restrictive decision (DSA art. 17). */
export function ReasonFields({
  reason,
  setReason,
  statement,
  setStatement,
  legal,
  setLegal,
  children,
}: {
  reason: string;
  setReason: (v: string) => void;
  statement: string;
  setStatement: (v: string) => void;
  legal?: string;
  setLegal?: (v: string) => void;
  children?: ReactNode;
}) {
  const t = useTranslations('Admin');
  const id = useId();
  return (
    <div className="grid gap-2">
      {children}
      <Label htmlFor={`${id}-r`}>{t('reason')}</Label>
      <select
        id={`${id}-r`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        {MODERATION_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`reasons.${r}`)}
          </option>
        ))}
      </select>
      <Label htmlFor={`${id}-s`}>{t('statement')}</Label>
      <Textarea
        id={`${id}-s`}
        rows={3}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
      />
      {setLegal ? (
        <>
          <Label htmlFor={`${id}-l`}>{t('legalGround')}</Label>
          <Input id={`${id}-l`} value={legal ?? ''} onChange={(e) => setLegal(e.target.value)} />
        </>
      ) : null}
    </div>
  );
}

function useAct(queryKey: unknown[]) {
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const act = async (path: string, body: object = {}) => {
    setError(null);
    try {
      await api.post(path, body);
      await qc.invalidateQueries({ queryKey });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  return { act, error };
}

// ───────────── Reports ─────────────

export function AdminReports() {
  const t = useTranslations('Admin');
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const { data } = useQuery({
    queryKey: ['admin-reports', status],
    queryFn: () => api.get<AdminReportItem[]>(`/api/v1/admin/reports?status=${status}`),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.reports')}</h1>
      <Tabs
        value={status}
        label={t('sections.reports')}
        onChange={setStatus}
        options={[
          ['OPEN', t('open')],
          ['CLOSED', t('closed')],
        ]}
      />
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-4">
        {data?.map((r) => (
          <li key={r.id}>
            <ReportCard report={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportCard({ report: r }: { report: AdminReportItem }) {
  const t = useTranslations('Admin');
  const tr = useTranslations('Report');
  const format = useFormatter();
  const id = useId();
  const { act, error } = useAct(['admin-reports']);
  const [decision, setDecision] = useState<string>('DISMISS');
  const [reason, setReason] = useState<string>(r.reasonCode);
  const [statement, setStatement] = useState('');
  const [legal, setLegal] = useState('');
  const [days, setDays] = useState(7);
  const open = r.status === 'OPEN' || r.status === 'IN_REVIEW';
  return (
    <article className="grid gap-2 rounded-xl border p-4 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {r.isIllegalContent ? (
          <span className="rounded bg-red-100 px-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-100">
            {t('illegal')}
          </span>
        ) : null}
        {tr(`target.${r.targetType as 'LISTING'}`)}:{' '}
        {r.targetPath ? (
          <Link href={r.targetPath} className="underline">
            {r.targetLabel}
          </Link>
        ) : (
          r.targetLabel
        )}
      </p>
      <p className="text-muted-foreground">
        {tr.has(`reasons.${r.reasonCode as 'SCAM'}`)
          ? tr(`reasons.${r.reasonCode as 'SCAM'}`)
          : r.reasonCode}{' '}
        · {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        {r.reporter.name ?? '—'} ({r.reporter.email ?? '—'})
        {r.sameTarget ? ` · ${t('sameTarget', { count: r.sameTarget })}` : ''}
      </p>
      <p className="whitespace-pre-line">{r.details}</p>
      {r.decision ? (
        <p>
          {t('decision')}: {r.decision}
        </p>
      ) : null}
      {r.targetUserId ? (
        <Link href={`/admin/utenti?id=${r.targetUserId}`} className="text-xs underline">
          {t('openUser')}
        </Link>
      ) : null}
      {open ? (
        <div className="grid gap-2 rounded-lg bg-muted p-3">
          <ReasonFields
            reason={reason}
            setReason={setReason}
            statement={statement}
            setStatement={setStatement}
            legal={legal}
            setLegal={setLegal}
          >
            <Label htmlFor={`${id}-d`}>{t('decisionType')}</Label>
            <select
              id={`${id}-d`}
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {REPORT_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`decisions.${d}`)}
                </option>
              ))}
            </select>
            {decision === 'SUSPEND_USER' ? (
              <>
                <Label htmlFor={`${id}-days`}>{t('days')}</Label>
                <Input
                  id={`${id}-days`}
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </>
            ) : null}
          </ReasonFields>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button
            size="sm"
            className="justify-self-start"
            disabled={statement.trim().length < 20}
            onClick={() =>
              act(`/api/v1/admin/reports/${r.id}/decide`, {
                decision,
                reasonCode: reason,
                statement,
                ...(legal.trim() ? { legalGround: legal } : {}),
                ...(decision === 'SUSPEND_USER' ? { days } : {}),
              })
            }
          >
            {t('decide')}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

// ───────────── Listings queue ─────────────

type ListingTab = 'PENDING_REVIEW' | 'REPORTED' | 'REMOVED' | 'REJECTED';

export function AdminListings() {
  const t = useTranslations('Admin');
  const [status, setStatus] = useState<ListingTab>('PENDING_REVIEW');
  const { data } = useQuery({
    queryKey: ['admin-listings', status],
    queryFn: () => api.get<AdminListingItem[]>(`/api/v1/admin/listings?status=${status}`),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.listings')}</h1>
      <Tabs
        value={status}
        label={t('sections.listings')}
        onChange={setStatus}
        options={(['PENDING_REVIEW', 'REPORTED', 'REMOVED', 'REJECTED'] as const).map((s) => [
          s,
          t(`listingTabs.${s}`),
        ])}
      />
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-4">
        {data?.map((l) => (
          <li key={l.id}>
            <ListingCard listing={l} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListingCard({ listing: l }: { listing: AdminListingItem }) {
  const t = useTranslations('Admin');
  const { act, error } = useAct(['admin-listings']);
  const [reason, setReason] = useState<string>('TERMS_VIOLATION');
  const [statement, setStatement] = useState('');
  const ok = statement.trim().length >= 20;
  const body = { reasonCode: reason, statement };
  return (
    <article className="grid gap-2 rounded-xl border p-4 text-sm">
      <p className="font-semibold">
        <Link href={`/annuncio/${l.slug}-${l.shortId}`} className="underline">
          {l.title}
        </Link>{' '}
        · {formatPrice(l.priceCents)}
      </p>
      <p className="text-muted-foreground">
        {l.seller.email}
        {l.seller.username ? ` (@${l.seller.username})` : ''} ·{' '}
        {t('reportsCount', { count: l.reports })}
      </p>
      {l.rejectionReason ? <p>{l.rejectionReason}</p> : null}
      <div className="grid gap-2 rounded-lg bg-muted p-3">
        <ReasonFields
          reason={reason}
          setReason={setReason}
          statement={statement}
          setStatement={setStatement}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {l.status === 'PENDING_REVIEW' ? (
            <>
              <Button size="sm" onClick={() => act(`/api/v1/admin/listings/${l.id}/approve`)}>
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!ok}
                onClick={() => act(`/api/v1/admin/listings/${l.id}/reject`, body)}
              >
                {t('reject')}
              </Button>
            </>
          ) : null}
          {['ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW'].includes(l.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!ok}
              onClick={() => act(`/api/v1/admin/listings/${l.id}/remove`, body)}
            >
              {t('remove')}
            </Button>
          ) : null}
          {l.status === 'REMOVED' || l.status === 'REJECTED' ? (
            <Button
              size="sm"
              disabled={!ok}
              onClick={() => act(`/api/v1/admin/listings/${l.id}/restore`, { statement })}
            >
              {t('restore')}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// ───────────── Appeals ─────────────

export function AdminAppeals() {
  const t = useTranslations('Admin');
  const tm = useTranslations('Moderation');
  const format = useFormatter();
  const { data } = useQuery({
    queryKey: ['admin-appeals'],
    queryFn: () => api.get<AdminAppealItem[]>('/api/v1/admin/appeals'),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.appeals')}</h1>
      <p className="text-sm text-muted-foreground">{t('appealsIntro')}</p>
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-4">
        {data?.map((a) => (
          <li key={a.id} className="grid gap-2 rounded-xl border p-4 text-sm">
            <p className="font-semibold">
              {tm(`actions.${a.actionType as 'USER_WARNED'}`)} · {a.targetLabel}
            </p>
            <p className="text-muted-foreground">
              {a.targetUser?.email} ·{' '}
              {format.dateTime(new Date(a.createdAt), { dateStyle: 'medium' })}
            </p>
            <p>
              <strong>{tm('reasons')}:</strong> {a.statementOfReasons}
            </p>
            <p className="rounded-md bg-muted p-2 whitespace-pre-line">
              <strong>{t('appealText')}:</strong> {a.appealText}
            </p>
            <AppealDecision id={a.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AppealDecision({ id }: { id: string }) {
  const t = useTranslations('Admin');
  const uid = useId();
  const { act, error } = useAct(['admin-appeals']);
  const [statement, setStatement] = useState('');
  const send = (outcome: 'UPHELD' | 'REVERSED') =>
    act(`/api/v1/admin/moderation-actions/${id}/appeal-decision`, { outcome, statement });
  return (
    <div className="grid gap-2 rounded-lg bg-muted p-3">
      <Label htmlFor={`${uid}-s`}>{t('statement')}</Label>
      <Textarea
        id={`${uid}-s`}
        rows={3}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={statement.trim().length < 20} onClick={() => send('REVERSED')}>
          {t('reverse')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={statement.trim().length < 20}
          onClick={() => send('UPHELD')}
        >
          {t('uphold')}
        </Button>
      </div>
    </div>
  );
}
