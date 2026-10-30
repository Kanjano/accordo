'use client';
import { ALERT_FREQUENCIES, type AlertFrequency, type SavedSearchItem } from '@accordo/shared';
import { Button, buttonVariants, Label } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { queryString } from '@/lib/search';

export function SavedSearchesList() {
  const t = useTranslations('SavedSearches');
  const format = useFormatter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => api.get<SavedSearchItem[]>('/api/v1/me/saved-searches'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-searches'] });
  const update = useMutation({
    mutationFn: ({ id, alertFrequency }: { id: string; alertFrequency: AlertFrequency }) =>
      api.patch(`/api/v1/me/saved-searches/${id}`, { alertFrequency }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/me/saved-searches/${id}`),
    onSettled: refresh,
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-3">
        {data?.map((s) => (
          <li key={s.id} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1">
              <h2 className="font-semibold">{s.name}</h2>
              <p className="text-xs text-muted-foreground">
                {t('createdAt', {
                  date: format.dateTime(new Date(s.createdAt), { dateStyle: 'medium' }),
                })}
              </p>
              <Link
                href={`/annunci${queryString(s.query)}`}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'justify-self-start',
                })}
              >
                {t('open')}
              </Link>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`freq-${s.id}`}>{t('alerts')}</Label>
                <select
                  id={`freq-${s.id}`}
                  value={s.alertFrequency}
                  onChange={(e) =>
                    update.mutate({ id: s.id, alertFrequency: e.target.value as AlertFrequency })
                  }
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {ALERT_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(`frequency.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('remove', { name: s.name })}
                onClick={() => remove.mutate(s.id)}
              >
                {t('delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
