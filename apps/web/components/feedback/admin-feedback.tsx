'use client';
import { FEEDBACK_REMOVAL_REASONS, type FeedbackItem } from '@accordo/shared';
import { Alert, Button, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { FeedbackEntry } from './feedback-entry';

/** SPEC §8.8: hidden (automatic checks) and reported feedback; removals need reasons. */
export function AdminFeedback() {
  const t = useTranslations('Feedback');
  const errorMessage = useErrorMessage();
  const { data, error } = useQuery({
    queryKey: ['admin-feedback'],
    queryFn: () => api.get<Array<FeedbackItem & { reports: number }>>('/api/v1/admin/feedback'),
  });
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('adminTitle')}</h1>
      {data && !data.length ? <p className="text-muted-foreground">{t('queueEmpty')}</p> : null}
      <ul className="grid gap-4">
        {data?.map((f) => (
          <li key={f.id} className="grid gap-2">
            <FeedbackEntry item={f} showStatus />
            {f.reports ? <p className="text-sm">{t('reports', { count: f.reports })}</p> : null}
            <Moderate id={f.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Moderate({ id }: { id: string }) {
  const t = useTranslations('Feedback');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [reason, setReason] = useState<string>('OFFENSIVE');
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (path: string, body: object = {}) => {
    setError(null);
    try {
      await api.post(`/api/v1/admin/feedback/${id}/${path}`, body);
      await qc.invalidateQueries({ queryKey: ['admin-feedback'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-r`}>{t('removalReason')}</Label>
        <select
          id={`${uid}-r`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-9 rounded-md border bg-background px-2"
        >
          {FEEDBACK_REMOVAL_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`removal.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <Label htmlFor={`${uid}-s`}>{t('statement')}</Label>
      <Textarea
        id={`${uid}-s`}
        rows={2}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={statement.trim().length < 20}
          onClick={() => act('remove', { reasonCode: reason, statement })}
        >
          {t('remove')}
        </Button>
        <Button size="sm" onClick={() => act('restore')}>
          {t('publishFeedback')}
        </Button>
      </div>
    </div>
  );
}
