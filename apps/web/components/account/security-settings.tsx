'use client';
import { Alert, Button, Field, Input } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { authClient } from '@/lib/auth-client';
import { unwrap } from '@/lib/better-auth-result';
import { useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { SettingsSection } from './settings-section';

/** Shared async-action state: busy flag, error and success messages. */
function useAction() {
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<{ busy: boolean; error: string | null; ok: string | null }>({
    busy: false,
    error: null,
    ok: null,
  });
  async function run(action: () => Promise<unknown>, okMessage?: string) {
    setState({ busy: true, error: null, ok: null });
    try {
      await action();
      setState({ busy: false, error: null, ok: okMessage ?? null });
      return true;
    } catch (e) {
      // A cancelled step-up dialog rejects with the original STEP_UP_REQUIRED error: no message needed.
      setState({
        busy: false,
        error: e && (e as { code?: string }).code !== 'STEP_UP_REQUIRED' ? errorMessage(e) : null,
        ok: null,
      });
      return false;
    }
  }
  const feedback = (
    <>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
    </>
  );
  return { ...state, run, feedback };
}

export function SecuritySettings() {
  const t = useTranslations('Settings.security');
  const alert = useSearchParams().get('avviso') === 'nuovo-accesso';
  return (
    <>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {alert ? <Alert tone="error">{t('newDeviceAlert')}</Alert> : null}
      <PasswordSection />
      <TwoFactorSection />
      <PasskeySection />
      <SessionsSection />
    </>
  );
}

function PasswordSection() {
  const t = useTranslations('Settings.security.password');
  const withStepUp = useStepUp();
  const { busy, run, feedback } = useAction();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(
      () =>
        withStepUp(() =>
          unwrap(
            authClient.changePassword({
              currentPassword: String(f.get('current')),
              newPassword: String(f.get('new')),
              revokeOtherSessions: true,
            }),
          ),
        ),
      t('done'),
    ).then((ok) => ok && form.reset());
  }

  return (
    <SettingsSection title={t('title')}>
      <form onSubmit={onSubmit} className="grid gap-4">
        {feedback}
        <Field label={t('current')}>
          <Input name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label={t('new')}>
          <Input name="new" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Button type="submit" className="justify-self-start" disabled={busy}>
          {t('submit')}
        </Button>
      </form>
    </SettingsSection>
  );
}

function TwoFactorSection() {
  const t = useTranslations('Settings.security.twoFactor');
  const withStepUp = useStepUp();
  const { data: session, refetch } = useSession();
  const { busy, run, feedback } = useAction();
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(
    null,
  );
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const enabled = !!(session?.user as { twoFactorEnabled?: boolean | null } | undefined)
    ?.twoFactorEnabled;

  function onEnable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    void run(async () => {
      const data = await unwrap(authClient.twoFactor.enable({ password }));
      if (data.method !== 'totp') throw new Error('Unexpected 2FA method');
      const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
      setSetup({
        qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }),
        secret,
        backupCodes: data.backupCodes,
      });
    });
  }

  function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).trim();
    void run(async () => {
      await unwrap(authClient.twoFactor.verifyTotp({ code }));
      setBackupCodes(setup?.backupCodes ?? null);
      setSetup(null);
      await refetch();
    }, t('enabled'));
  }

  function onDisable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    void run(async () => {
      await withStepUp(() => unwrap(authClient.twoFactor.disable({ password })));
      setBackupCodes(null);
      await refetch();
    }, t('disabled'));
  }

  return (
    <SettingsSection
      title={t('title')}
      description={`${enabled ? t('on') : t('off')} · ${t('recommended')}`}
    >
      <div className="grid gap-4">
        {feedback}
        {backupCodes ? (
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">{t('backupCodes')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('backupHelp')}</p>
            <ul
              className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm"
              data-testid="backup-codes"
            >
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {setup ? (
          <form onSubmit={onVerify} className="grid gap-4">
            <p className="text-sm">{t('scan')}</p>
            {/* biome-ignore lint/performance/noImgElement: data URL generated locally */}
            <img
              src={setup.qr}
              alt={t('qrAlt')}
              width={200}
              height={200}
              className="rounded border"
            />
            <p className="text-sm">
              {t('secret')}{' '}
              <code data-testid="totp-secret" className="break-all rounded bg-muted px-1 py-0.5">
                {setup.secret}
              </code>
            </p>
            <Field label={t('code')}>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
            </Field>
            <Button type="submit" className="justify-self-start" disabled={busy}>
              {t('verify')}
            </Button>
          </form>
        ) : (
          <form onSubmit={enabled ? onDisable : onEnable} className="grid gap-4">
            <Field label={t('password')}>
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Button
              type="submit"
              variant={enabled ? 'outline' : 'default'}
              className="justify-self-start"
              disabled={busy}
            >
              {enabled ? t('disable') : t('enable')}
            </Button>
          </form>
        )}
      </div>
    </SettingsSection>
  );
}

function PasskeySection() {
  const t = useTranslations('Settings.security.passkeys');
  const format = useFormatter();
  const withStepUp = useStepUp();
  const qc = useQueryClient();
  const { busy, run, feedback } = useAction();
  const { data: passkeys = [] } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => unwrap(authClient.passkey.listUserPasskeys()),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['passkeys'] });

  return (
    <SettingsSection title={t('title')} description={t('intro')}>
      <div className="grid gap-4">
        {feedback}
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}
        <ul className="grid gap-2">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <span>
                {p.name || t('unnamed')}
                {p.createdAt ? (
                  <span className="block text-muted-foreground">
                    {t('created', {
                      date: format.dateTime(new Date(p.createdAt), { dateStyle: 'medium' }),
                    })}
                  </span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await withStepUp(() => unwrap(authClient.passkey.deletePasskey({ id: p.id })));
                    await refresh();
                  })
                }
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await unwrap(authClient.passkey.addPasskey());
              refresh();
            }, t('added'))
          }
        >
          {t('add')}
        </Button>
      </div>
    </SettingsSection>
  );
}

function SessionsSection() {
  const t = useTranslations('Settings.security.sessions');
  const format = useFormatter();
  const qc = useQueryClient();
  const { data: current } = useSession();
  const { busy, run, feedback } = useAction();
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => unwrap(authClient.listSessions()),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sessions'] });

  return (
    <SettingsSection title={t('title')}>
      <div className="grid gap-4">
        {feedback}
        <ul className="grid gap-2">
          {sessions.map((s) => {
            const isCurrent = s.token === current?.session.token;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate">{s.userAgent || t('unknown')}</span>
                  <span className="text-muted-foreground">
                    {isCurrent
                      ? t('current')
                      : t('lastActive', {
                          date: format.dateTime(new Date(s.updatedAt), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                        })}
                  </span>
                </span>
                {!isCurrent ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await unwrap(authClient.revokeSession({ token: s.token }));
                        await refresh();
                      })
                    }
                  >
                    {t('revoke')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await unwrap(authClient.revokeOtherSessions());
              refresh();
            }, t('done'))
          }
        >
          {t('revokeOthers')}
        </Button>
      </div>
    </SettingsSection>
  );
}
