'use client';
import { FEEDBACK_REPORT_REASONS, type FeedbackItem } from '@accordo/shared';
import { Button, cn, Label, Textarea } from '@accordo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { StarsValue } from './stars';

const TONE = {
  POSITIVE: 'text-emerald-700 dark:text-emerald-400',
  NEUTRAL: 'text-muted-foreground',
  NEGATIVE: 'text-red-700 dark:text-red-400',
};

/** One feedback (SPEC §8.9) with the viewer's actions: reply, revision request, report. */
export function FeedbackEntry({
  item: f,
  showStatus = false,
  queryKey,
}: {
  item: FeedbackItem;
  showStatus?: boolean;
  queryKey?: unknown[];
}) {
  const t = useTranslations('Feedback');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [mode, setMode] = useState<'reply' | 'revision' | 'report' | null>(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState<string>('EXTORTION');
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    setNotice(null);
    try {
      if (mode === 'reply') await api.post(`/api/v1/feedback/${f.id}/reply`, { body: text });
      if (mode === 'revision')
        await api.post(`/api/v1/feedback/${f.id}/revision-request`, { message: text });
      if (mode === 'report')
        await api.post(`/api/v1/feedback/${f.id}/report`, { reasonCode: reason, details: text });
      setNotice(t(`sent.${mode as 'reply'}`));
      setMode(null);
      setText('');
      if (queryKey) await qc.invalidateQueries({ queryKey });
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }

  const dsr = Object.entries(f.dsr).filter(([, v]) => v != null) as Array<[string, number]>;
  return (
    <article className="grid gap-2 rounded-xl border p-4 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <strong className={TONE[f.rating]}>{t(`rating.${f.rating}`)}</strong>
        <span className="text-muted-foreground">
          {f.role === 'BUYER_TO_SELLER' ? t('fromBuyer') : t('fromSeller')} {f.author.name} (
          {f.author.score}) · {format.dateTime(new Date(f.createdAt), { dateStyle: 'medium' })}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-emerald-800 dark:text-emerald-300">
          <BadgeCheck aria-hidden className="size-3.5" />
          {t('verified')}
        </span>
        {f.revised ? <span className="text-xs text-muted-foreground">{t('revised')}</span> : null}
        {showStatus && f.status !== 'PUBLISHED' ? (
          <span className="rounded bg-secondary px-2 text-xs">{t(`status.${f.status}`)}</span>
        ) : null}
      </p>
      <p className="text-muted-foreground">{f.listingTitle}</p>
      {f.comment ? <p className="whitespace-pre-wrap">{f.comment}</p> : null}
      {dsr.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {dsr.map(([k, v]) => (
            <li key={k} className="flex items-center gap-1">
              {t(`dsr.${k as 'itemAsDescribed'}`)}
              <StarsValue value={v} label={t('starsValue', { value: v })} />
            </li>
          ))}
        </ul>
      ) : null}
      {f.reply ? (
        <p className="border-l-2 pl-3 text-muted-foreground">
          <strong>{t('replyBy', { name: f.recipient.name })}</strong> {f.reply}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {f.actions.includes('reply') ? (
          <Button size="sm" variant="ghost" onClick={() => setMode('reply')}>
            {t('reply')}
          </Button>
        ) : null}
        {f.actions.includes('requestRevision') ? (
          <Button size="sm" variant="ghost" onClick={() => setMode('revision')}>
            {t('requestRevision')}
          </Button>
        ) : null}
        {f.actions.includes('report') ? (
          <Button size="sm" variant="ghost" onClick={() => setMode('report')}>
            {t('report')}
          </Button>
        ) : null}
      </div>
      {mode ? (
        <div className={cn('grid gap-2 rounded-lg bg-muted p-3')}>
          {mode === 'report' ? (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-r`}>{t('reportReason')}</Label>
              <select
                id={`${id}-r`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-9 rounded-md border bg-background px-2"
              >
                {FEEDBACK_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`reportReasons.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Label htmlFor={`${id}-t`}>{t(`modeLabel.${mode}`)}</Label>
          <Textarea
            id={`${id}-t`}
            rows={2}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={mode !== 'report' && !text.trim()}>
              {t('send')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </article>
  );
}
