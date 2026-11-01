'use client';
import { Alert, Button, Field, Input } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { CookieSettingsButton } from '@/components/consent/cookie-banner';
import { useStepUp } from '@/components/step-up';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { signOut } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { SettingsSection } from './settings-section';

export function PrivacySettings() {
  const t = useTranslations('Settings.privacy');
  const errorMessage = useErrorMessage();
  const withStepUp = useStepUp();
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [exportError, setExportError] = useState<string | null>(null);
  async function onExport() {
    setExportError(null);
    try {
      const data = await withStepUp(() => api.get<object>('/api/v1/me/data-export'));
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `accordo-dati-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if ((err as { problem?: { code?: string } } | null)?.problem?.code !== 'STEP_UP_REQUIRED')
        setExportError(errorMessage(err));
    }
  }

  async function onDelete(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => api.delete('/api/v1/me'));
      await signOut().catch(() => undefined);
      router.push('/');
      router.refresh();
    } catch (err) {
      if ((err as { problem?: { code?: string } } | null)?.problem?.code !== 'STEP_UP_REQUIRED')
        setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <SettingsSection title={t('cookies.title')} description={t('cookies.text')}>
        <CookieSettingsButton
          label={t('cookies.button')}
          className="text-sm text-primary underline underline-offset-4"
        />
      </SettingsSection>
      <SettingsSection title={t('export.title')} description={t('export.text')}>
        <div className="grid gap-2">
          {exportError ? <Alert tone="error">{exportError}</Alert> : null}
          <Button variant="outline" className="justify-self-start" onClick={onExport}>
            {t('export.button')}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title={t('delete.title')} description={t('delete.text')}>
        <form onSubmit={onDelete} className="grid gap-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label={t('delete.confirmLabel')}>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button
            type="submit"
            variant="destructive"
            className="justify-self-start"
            disabled={busy || confirm !== t('delete.confirmWord')}
          >
            {t('delete.submit')}
          </Button>
        </form>
      </SettingsSection>
    </>
  );
}
