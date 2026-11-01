'use client';
import type { ModerationActionItem, MyReportItem } from '@accordo/shared';
import { Alert, Button, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

/** Decisions about me (statement of reasons + appeal, DSA art. 17/20) and my reports. */
export function AccountModeration() {
  const t = useTranslations('Moderation');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const { data: actions } = useQuery({
    queryKey: ['my-moderation'],
    queryFn: () => api.get<ModerationActionItem[]>('/api/v1/me/moderation-actions'),
  });
  const { data: reports } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => api.get<MyReportItem[]>('/api/v1/me/reports'),
  });
  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
        {actions && !actions.length ? <p>{t('noActions')}</p> : null}
        <ul className="grid gap-3">
          {actions?.map((a) => (
            <li key={a.id}>
              <ActionCard action={a} date={date} />
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t('myReports')}</h2>
        {reports && !reports.length ? (
          <p className="text-muted-foreground">{t('noReports')}</p>
        ) : null}
        <ul className="grid gap-2 text-sm">
          {reports?.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <p className="font-medium">
                {r.targetLabel} · {t(`reportStatus.${r.status}`)}
              </p>
              <p className="text-muted-foreground">{date(r.createdAt)}</p>
              {r.decision ? (
                <p>
                  {t('decision')}: {r.decision}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActionCard({
  action: a,
  date,
}: {
  action: ModerationActionItem;
  date: (s: string) => string;
}) {
  const t = useTranslations('Moderation');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function appeal() {
    setError(null);
    try {
      await api.post(`/api/v1/moderation-actions/${a.id}/appeal`, { text });
      await qc.invalidateQueries({ queryKey: ['my-moderation'] });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <article className="grid gap-2 rounded-xl border p-4 text-sm">
      <p className="font-semibold">
        {t(`actions.${a.actionType as 'USER_WARNED'}`)} · {a.targetLabel}
      </p>
      <p className="text-muted-foreground">{date(a.createdAt)}</p>
      <p>
        <strong>{t('reasons')}:</strong> {a.statementOfReasons}
      </p>
      {a.legalGround ? (
        <p>
          <strong>{t('legalGround')}:</strong> {a.legalGround}
        </p>
      ) : null}
      {a.appealedAt ? (
        <p className="rounded-md bg-muted p-2">
          {a.appealOutcome
            ? `${t(`appealOutcome.${a.appealOutcome}`)}: ${a.appealStatement ?? ''}`
            : t('appealPending')}
        </p>
      ) : null}
      {a.canAppeal && !open ? (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => setOpen(true)}
        >
          {t('appeal')}
        </Button>
      ) : null}
      {open ? (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-t`}>{t('appealText')}</Label>
          <Textarea
            id={`${id}-t`}
            rows={4}
            maxLength={3000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={text.trim().length < 20} onClick={appeal}>
              {t('sendAppeal')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
