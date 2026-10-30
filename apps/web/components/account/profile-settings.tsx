'use client';
import type { MeResponse } from '@accordo/shared';
import { Alert, Button, Checkbox, Field, Input, Textarea } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { ComuneCombobox, type ComuneValue } from '@/components/comune-combobox';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { SettingsSection } from './settings-section';

export function ProfileSettings() {
  const t = useTranslations('Settings.profile');
  const tc = useTranslations('Common');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
  });
  const [comune, setComune] = useState<ComuneValue | null>(null);
  useEffect(() => setComune(me?.comune ?? null), [me]);

  const save = useMutation({
    mutationFn: (body: object) => api.patch<MeResponse>('/api/v1/me', body),
    onSuccess: (data) => qc.setQueryData(['me'], data),
  });

  if (!me) return <p>{tc('loading')}</p>;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      name: String(f.get('name')),
      username: String(f.get('username')),
      bio: String(f.get('bio') ?? '') || null,
      comuneId: comune?.id ?? null,
      marketingConsent: f.get('marketing') === 'on',
    });
  }

  return (
    <SettingsSection title={t('title')} as="h1">
      <form onSubmit={onSubmit} className="grid gap-4">
        {save.isSuccess ? <Alert tone="success">{tc('saved')}</Alert> : null}
        {save.isError ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        <Field label={t('name')}>
          <Input
            name="name"
            defaultValue={me.name}
            required
            minLength={2}
            maxLength={60}
            autoComplete="name"
          />
        </Field>
        <Field label={t('username')}>
          <Input
            name="username"
            defaultValue={me.username ?? ''}
            required
            pattern="[a-z0-9._]{3,30}"
            autoCapitalize="none"
          />
        </Field>
        <Field label={t('comune')} description={t('comuneHelp')}>
          <ComuneCombobox value={comune} onChange={setComune} />
        </Field>
        <Field label={t('bio')} description={t('bioHelp')}>
          <Textarea name="bio" defaultValue={me.bio ?? ''} maxLength={1000} rows={4} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="marketing" defaultChecked={me.marketingConsent} />
          {t('marketing')}
        </label>
        <Button type="submit" className="justify-self-start" disabled={save.isPending}>
          {tc('save')}
        </Button>
      </form>
    </SettingsSection>
  );
}
