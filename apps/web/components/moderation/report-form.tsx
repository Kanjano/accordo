'use client';
import { REPORT_REASONS, type ReportTarget, reportCreateSchema } from '@accordo/shared';
import { Alert, Button, Checkbox, Field, Input, Textarea } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { captchaHeaders, Turnstile, turnstileEnabled } from '@/components/auth/turnstile';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';

/** DSA notice & action form (SPEC §14.2): open to everyone, Turnstile-protected. */
export function ReportForm({
  targetType,
  targetId,
  label,
}: {
  targetType: Exclude<ReportTarget, 'FEEDBACK'>;
  targetId: string;
  label: string;
}) {
  const t = useTranslations('Report');
  const v = useValidationMessage();
  const errorMessage = useErrorMessage();
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = reportCreateSchema.safeParse({
      targetType,
      targetId,
      reasonCode: f.get('reasonCode'),
      details: f.get('details'),
      isIllegalContent: f.get('isIllegalContent') === 'on',
      goodFaithConfirmed: f.get('goodFaithConfirmed') === 'on' ? true : undefined,
      ...(session
        ? {}
        : {
            reporterName: String(f.get('reporterName') ?? '') || undefined,
            reporterEmail: String(f.get('reporterEmail') ?? '') || undefined,
          }),
    });
    const issues: Record<string, string | undefined> = parsed.success
      ? {}
      : Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            v(i.message.startsWith('Invalid') ? 'required' : i.message),
          ]),
        );
    if (!session && !f.get('reporterName')) issues.reporterName = v('required');
    if (!session && !f.get('reporterEmail')) issues.reporterEmail = v('required');
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.request('/api/v1/reports', {
        method: 'POST',
        json: parsed.data,
        headers: captchaHeaders(token),
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Alert tone="success">
        {t('sent')}{' '}
        {session ? (
          <Link href="/account/moderazione" className="underline">
            {t('follow')}
          </Link>
        ) : null}
      </Alert>
    );

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <p className="rounded-lg bg-muted p-3 text-sm">
        {t(`target.${targetType}`)}: <strong>{label}</strong>
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label={t('reason')} error={errors.reasonCode}>
        <select
          name="reasonCode"
          defaultValue="SCAM"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('details')} description={t('detailsHelp')} error={errors.details}>
        <Textarea name="details" rows={5} maxLength={3000} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="isIllegalContent" className="mt-0.5" />
        {t('illegal')}
      </label>
      {session ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('name')} error={errors.reporterName}>
            <Input name="reporterName" autoComplete="name" />
          </Field>
          <Field label={t('email')} error={errors.reporterEmail}>
            <Input name="reporterEmail" type="email" autoComplete="email" />
          </Field>
        </div>
      )}
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="goodFaithConfirmed" className="mt-0.5" />
          {t('goodFaith')}
        </label>
        {errors.goodFaithConfirmed ? (
          <p className="text-sm text-destructive">{errors.goodFaithConfirmed}</p>
        ) : null}
      </div>
      <Turnstile onToken={setToken} />
      <Button
        type="submit"
        className="justify-self-start"
        disabled={busy || (turnstileEnabled && !token)}
      >
        {t('submit')}
      </Button>
    </form>
  );
}
