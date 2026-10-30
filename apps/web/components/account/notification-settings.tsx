'use client';
import { NOTIFICATION_CHANNELS, type NotificationPreference } from '@accordo/shared';
import { Alert, Checkbox } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { SettingsSection } from './settings-section';

type Row = NotificationPreference & { mandatory: boolean };

/** Type × channel matrix (SPEC §3.9). Mandatory types are always on; push arrives in a later phase. */
export function NotificationSettings() {
  const t = useTranslations('Settings.notifications');
  const tc = useTranslations('Common');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const { data: rows } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<Row[]>('/api/v1/me/notification-preferences'),
  });
  const save = useMutation({
    mutationFn: (pref: NotificationPreference) =>
      api.put<Row[]>('/api/v1/me/notification-preferences', { preferences: [pref] }),
    onSuccess: (data) => qc.setQueryData(['notification-preferences'], data),
  });

  if (!rows) return <p>{tc('loading')}</p>;
  const types = [...new Set(rows.map((r) => r.type))];
  const cell = (type: string, channel: string) =>
    rows.find((r) => r.type === type && r.channel === channel);

  return (
    <SettingsSection title={t('title')} description={t('intro')} as="h1">
      {save.isError ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('type')}
              </th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-center font-medium">
                  {t(`channels.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type} className="border-b last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {t(`types.${type.replaceAll('.', '_')}` as 'types.message_new')}
                  {cell(type, 'EMAIL')?.mandatory ? (
                    <span className="block text-xs text-muted-foreground">{t('mandatory')}</span>
                  ) : null}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const c = cell(type, channel);
                  const label = `${t(`types.${type.replaceAll('.', '_')}` as 'types.message_new')} — ${t(`channels.${channel}`)}`;
                  return (
                    <td key={channel} className="px-3 py-2 text-center">
                      <Checkbox
                        aria-label={label}
                        checked={c?.enabled ?? false}
                        disabled={c?.mandatory || channel === 'PUSH' || save.isPending}
                        onChange={(e) =>
                          save.mutate({
                            type: type as Row['type'],
                            channel,
                            enabled: e.target.checked,
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t('pushSoon')}</p>
    </SettingsSection>
  );
}
