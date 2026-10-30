'use client';
import { type SignUpInput, signUpSchema } from '@accordo/shared';
import { Alert, Button, buttonVariants, Checkbox, Field, Input } from '@accordo/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { unwrap } from '@/lib/better-auth-result';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';
import { captchaHeaders, Turnstile, turnstileEnabled } from './turnstile';

export function SignUpForm() {
  const t = useTranslations('Auth.signUp');
  const errorMessage = useErrorMessage();
  const v = useValidationMessage();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<
    z.input<typeof signUpSchema>,
    unknown,
    SignUpInput
  >({
    resolver: zodResolver(signUpSchema),
    defaultValues: { marketingConsent: false },
  });
  const err = formState.errors;

  const onSubmit = handleSubmit(async (input) => {
    setError(null);
    try {
      await unwrap(
        authClient.signUp.email(
          // acceptTerms/marketingConsent are read by the API's sign-up hook.
          {
            ...input,
            callbackURL: `${window.location.origin}/verifica-email?stato=ok`,
          } as unknown as Parameters<typeof authClient.signUp.email>[0],
          { headers: captchaHeaders(token) },
        ),
      );
      setSentTo(input.email);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  if (sentTo) {
    return (
      <Alert tone="success">
        <strong className="block">{t('checkEmailTitle')}</strong>
        {t('checkEmailText', { email: sentTo })}
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label={t('name')} error={v(err.name?.message)}>
        <Input autoComplete="name" {...register('name')} />
      </Field>
      <Field label={t('username')} description={t('usernameHelp')} error={v(err.username?.message)}>
        <Input autoComplete="username" autoCapitalize="none" {...register('username')} />
      </Field>
      <Field label={t('email')} error={v(err.email?.message)}>
        <Input type="email" autoComplete="email" {...register('email')} />
      </Field>
      <Field label={t('password')} description={t('passwordHelp')} error={v(err.password?.message)}>
        <Input type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      <div className="grid gap-1">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            aria-invalid={err.acceptTerms ? true : undefined}
            {...register('acceptTerms')}
          />
          <span>
            {t.rich('terms', {
              terms: (c) => (
                <Link href="/termini" className="underline underline-offset-4" target="_blank">
                  {c}
                </Link>
              ),
              privacy: (c) => (
                <Link href="/privacy" className="underline underline-offset-4" target="_blank">
                  {c}
                </Link>
              ),
            })}
          </span>
        </label>
        <p aria-live="polite" className="text-sm text-destructive empty:hidden">
          {v(err.acceptTerms?.message)}
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox className="mt-0.5" {...register('marketingConsent')} />
        <span>{t('marketing')}</span>
      </label>
      <Turnstile onToken={setToken} />
      <Button type="submit" disabled={formState.isSubmitting || (turnstileEnabled && !token)}>
        {t('submit')}
      </Button>
      <p className="text-center text-sm">
        {t('haveAccount')}{' '}
        <Link
          href="/accedi"
          className={buttonVariants({ variant: 'link', className: 'h-auto p-0' })}
        >
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}
