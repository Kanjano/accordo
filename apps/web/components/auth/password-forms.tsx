'use client';
import { passwordSchema } from '@accordo/shared';
import { Alert, Button, buttonVariants, Field, Input } from '@accordo/ui';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { unwrap } from '@/lib/better-auth-result';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';
import { captchaHeaders, Turnstile, turnstileEnabled } from './turnstile';

export function ForgotPasswordForm() {
  const t = useTranslations('Auth.forgot');
  const errorMessage = useErrorMessage();
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await unwrap(
        authClient.requestPasswordReset(
          {
            email: String(new FormData(e.currentTarget).get('email')),
            redirectTo: `${window.location.origin}/reimposta-password`,
          },
          { headers: captchaHeaders(token) },
        ),
      );
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Same answer whether or not the address exists (no account enumeration).
  if (sent) return <Alert tone="success">{t('sent')}</Alert>;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('text')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label={t('email')}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Turnstile onToken={setToken} />
      <Button type="submit" disabled={turnstileEnabled && !token}>
        {t('submit')}
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations('Auth.reset');
  const errorMessage = useErrorMessage();
  const v = useValidationMessage();
  const params = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') ? t('invalid') : null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setFieldError(v(parsed.error.issues[0]?.message));
    if (password !== form.get('confirm')) return setFieldError(v('PASSWORDS_DIFFER'));
    setFieldError(undefined);
    try {
      await unwrap(authClient.resetPassword({ newPassword: password, token: token ?? '' }));
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const signIn = (
    <Link href="/accedi" className={buttonVariants()}>
      {t('signIn')}
    </Link>
  );
  if (done)
    return (
      <div className="grid gap-4">
        <Alert tone="success">{t('done')}</Alert>
        {signIn}
      </div>
    );
  if (!token)
    return (
      <div className="grid gap-4">
        <Alert tone="error">{t('invalid')}</Alert>
      </div>
    );
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label={t('password')} error={fieldError}>
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t('confirm')}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}

/** "Non sono stato io" from the new-device email: one explicit click locks the account down. */
export function NotMeForm() {
  const t = useTranslations('Auth.notMe');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/not-me', { token });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Alert tone="success">{t('done')}</Alert>;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('text')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" variant="destructive" disabled={busy || !token}>
        {t('submit')}
      </Button>
    </form>
  );
}
