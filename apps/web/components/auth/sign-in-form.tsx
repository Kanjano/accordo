'use client';
import { Alert, Button, buttonVariants, Checkbox, Field, Input } from '@accordo/ui';
import { KeyRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { unwrap } from '@/lib/better-auth-result';
import { useErrorMessage } from '@/lib/use-error-message';

/** Only same-site relative paths are accepted as post-login destinations (open-redirect guard). */
export function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export function SignInForm() {
  const t = useTranslations('Auth.signIn');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [step, setStep] = useState<'password' | 'totp' | 'backup'>('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  const done = () => {
    router.push(next);
    router.refresh();
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(async () => {
      const data = await unwrap(
        authClient.signIn.email({
          email: String(form.get('email')),
          password: String(form.get('password')),
        }),
      );
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) setStep('totp');
      else done();
    });
  }

  function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).trim();
    void run(async () => {
      if (step === 'totp') await unwrap(authClient.twoFactor.verifyTotp({ code, trustDevice }));
      else await unwrap(authClient.twoFactor.verifyBackupCode({ code, trustDevice }));
      done();
    });
  }

  if (step !== 'password') {
    return (
      <form onSubmit={onCode} className="grid gap-4" noValidate>
        <h2 className="font-semibold">{t('twoFactorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('twoFactorHelp')}</p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {step === 'totp' ? (
          <Field label={t('totpCode')} key="totp">
            <Input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
            />
          </Field>
        ) : (
          <Field label={t('backupCode')} key="backup">
            <Input name="code" autoComplete="off" required autoFocus />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
          {t('trustDevice')}
        </label>
        <Button type="submit" disabled={busy}>
          {t('verify')}
        </Button>
        <Button variant="link" onClick={() => setStep(step === 'totp' ? 'backup' : 'totp')}>
          {step === 'totp' ? t('useBackupCode') : t('useTotp')}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onPassword} className="grid gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label={t('email')}>
          <Input name="email" type="email" autoComplete="username webauthn" required />
        </Field>
        <Field label={t('password')}>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Link
          href="/password-dimenticata"
          className="justify-self-end text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('forgot')}
        </Link>
        <Button type="submit" disabled={busy}>
          {t('submit')}
        </Button>
      </form>
      <p className="text-center text-xs uppercase text-muted-foreground">{t('or')}</p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await unwrap(authClient.signIn.passkey());
            done();
          })
        }
      >
        <KeyRound aria-hidden />
        {t('passkey')}
      </Button>
      {process.env.NEXT_PUBLIC_GOOGLE_ENABLED ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await unwrap(
                authClient.signIn.social({
                  provider: 'google',
                  callbackURL: `${window.location.origin}${next}`,
                }),
              );
            })
          }
        >
          {t('google')}
        </Button>
      ) : null}
      <p className="text-center text-sm">
        {t('noAccount')}{' '}
        <Link
          href="/registrati"
          className={buttonVariants({ variant: 'link', className: 'h-auto p-0' })}
        >
          {t('register')}
        </Link>
      </p>
    </div>
  );
}
