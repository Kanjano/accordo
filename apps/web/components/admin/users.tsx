'use client';
import { type AdminUserDetail, type AdminUserItem, SANCTIONS } from '@accordo/shared';
import { Alert, Button, Input, Label } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { useErrorMessage } from '@/lib/use-error-message';
import { ReasonFields } from './moderation';

/** User search, detail, sanctions with statement of reasons, read-only impersonation. */
export function AdminUsers() {
  const t = useTranslations('Admin');
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(q);
  const selected = params.get('id');
  const { data } = useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => api.get<AdminUserItem[]>(`/api/v1/admin/users?q=${encodeURIComponent(query)}`),
  });
  const select = (id: string) => router.replace(`?id=${id}`);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.users')}</h1>
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <Input
          aria-label={t('searchUsers')}
          placeholder={t('searchUsers')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit">{t('search')}</Button>
      </form>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <ul className="grid content-start gap-1 text-sm">
          {data?.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => select(u.id)}
                className="w-full rounded-md px-3 py-2 text-left hover:bg-accent aria-pressed:bg-accent"
                aria-pressed={selected === u.id}
              >
                <span className="font-medium">{u.email}</span>{' '}
                <span className="text-muted-foreground">
                  {u.username ? `@${u.username} · ` : ''}
                  {t(`status.${u.status}`)} · {u.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? <UserDetail id={selected} /> : null}
      </div>
    </div>
  );
}

function UserDetail({ id }: { id: string }) {
  const t = useTranslations('Admin');
  const tm = useTranslations('Moderation');
  const format = useFormatter();
  const uid = useId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const withStepUp = useStepUp();
  const { data: session } = useSession();
  const { data: u } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => api.get<AdminUserDetail>(`/api/v1/admin/users/${id}`),
  });
  const [type, setType] = useState<string>('WARN');
  const [reason, setReason] = useState<string>('TERMS_VIOLATION');
  const [statement, setStatement] = useState('');
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  if (!u) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await withStepUp(fn);
      await qc.invalidateQueries({ queryKey: ['admin-user', id] });
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
      setStatement('');
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section
      className="grid content-start gap-3 rounded-xl border p-4 text-sm"
      aria-label={u.email}
    >
      <h2 className="text-lg font-semibold">{u.name}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Email</dt>
        <dd>{u.email}</dd>
        <dt className="text-muted-foreground">{t('statusLabel')}</dt>
        <dd>
          {t(`status.${u.status}`)}
          {u.banExpires
            ? ` (${format.dateTime(new Date(u.banExpires), { dateStyle: 'medium' })})`
            : ''}
        </dd>
        <dt className="text-muted-foreground">{t('memberSince')}</dt>
        <dd>{format.dateTime(new Date(u.createdAt), { dateStyle: 'medium' })}</dd>
        <dt className="text-muted-foreground">{t('activity')}</dt>
        <dd>
          {t('counts', {
            listings: u.counts.listings,
            purchases: u.counts.purchases,
            sales: u.counts.sales,
            reports: u.counts.reportsAgainst,
            flagged: u.counts.flaggedMessages,
          })}
        </dd>
      </dl>
      {u.role === 'user' && u.status !== 'DELETED' ? (
        <div className="grid gap-2 rounded-lg bg-muted p-3">
          <ReasonFields
            reason={reason}
            setReason={setReason}
            statement={statement}
            setStatement={setStatement}
          >
            <Label htmlFor={`${uid}-t`}>{t('sanction')}</Label>
            <select
              id={`${uid}-t`}
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {SANCTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`sanctions.${s}`)}
                </option>
              ))}
            </select>
            {type === 'SUSPEND' ? (
              <>
                <Label htmlFor={`${uid}-d`}>{t('days')}</Label>
                <Input
                  id={`${uid}-d`}
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
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={statement.trim().length < 20}
              onClick={() =>
                run(() =>
                  api.post(`/api/v1/admin/users/${id}/sanction`, {
                    type,
                    reasonCode: reason,
                    statement,
                    days,
                  }),
                )
              }
            >
              {t('applySanction')}
            </Button>
            {u.status !== 'ACTIVE' ? (
              <Button
                size="sm"
                disabled={statement.trim().length < 20}
                onClick={() =>
                  run(() => api.post(`/api/v1/admin/users/${id}/reinstate`, { statement }))
                }
              >
                {t('reinstate')}
              </Button>
            ) : null}
            {session?.user.role === 'admin' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await run(() => api.post(`/api/v1/admin/users/${id}/impersonate`));
                  window.location.assign('/');
                }}
              >
                {t('impersonate')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <h3 className="font-semibold">{t('history')}</h3>
      {u.actions.length ? (
        <ul className="grid gap-2">
          {u.actions.map((a) => (
            <li key={a.id} className="rounded-md border p-2">
              <p className="font-medium">
                {tm(`actions.${a.actionType as 'USER_WARNED'}`)} ·{' '}
                {format.dateTime(new Date(a.createdAt), { dateStyle: 'medium' })}
              </p>
              <p>{a.statementOfReasons}</p>
              {a.appealOutcome ? <p>{tm(`appealOutcome.${a.appealOutcome}`)}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}
    </section>
  );
}
