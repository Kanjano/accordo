'use client';
import { type TaxStatus, taxProfileSchema } from '@accordo/shared';
import { Alert, Button, Field, Input } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';

/** DAC7 seller data (SPEC §14.4): asked near the thresholds, encrypted at rest. */
export function TaxProfile() {
  const t = useTranslations('Tax');
  const tc = useTranslations('Common');
  const format = useFormatter();
  const v = useValidationMessage();
  const errorMessage = useErrorMessage();
  const withStepUp = useStepUp();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['tax-profile'],
    queryFn: () => api.get<TaxStatus>('/api/v1/me/tax-profile'),
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return null;
  const p = data.profile;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const parsed = taxProfileSchema.safeParse(Object.fromEntries(f.entries()));
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            v(i.message.startsWith('Invalid') ? 'required' : i.message),
          ]),
        ),
      );
      return;
    }
    setErrors({});
    setError(null);
    try {
      const next = await withStepUp(() =>
        api.put<TaxStatus>('/api/v1/me/tax-profile', parsed.data),
      );
      qc.setQueryData(['tax-profile'], next);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="max-w-prose text-muted-foreground">{t('intro')}</p>
      <p className="text-sm">
        {t('year', {
          activities: data.year.activities,
          amount: formatPrice(data.year.considerationCents),
        })}
      </p>
      {data.required && !p ? <Alert tone="error">{t('required')}</Alert> : null}
      {p ? (
        <Alert tone="success">
          {t('onFile', {
            date: format.dateTime(new Date(p.collectedAt), { dateStyle: 'medium' }),
            taxId: p.taxIdMasked,
            iban: p.ibanMasked ?? '—',
          })}
        </Alert>
      ) : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form onSubmit={submit} className="grid gap-4" noValidate autoComplete="off">
        <Field label={t('legalName')} error={errors.legalName}>
          <Input name="legalName" defaultValue={p?.legalName} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('taxId')} description={t('taxIdHelp')} error={errors.taxId}>
            <Input name="taxId" maxLength={16} />
          </Field>
          <Field label={t('birthDate')} error={errors.birthDate}>
            <Input name="birthDate" type="date" />
          </Field>
          <Field label={`${t('vatNumber')} (${tc('optional')})`} error={errors.vatNumber}>
            <Input
              name="vatNumber"
              inputMode="numeric"
              maxLength={11}
              defaultValue={p?.vatNumber ?? ''}
            />
          </Field>
          <Field label={t('iban')} error={errors.iban}>
            <Input name="iban" maxLength={34} />
          </Field>
        </div>
        <Field label={t('address')} error={errors.addressLine}>
          <Input name="addressLine" defaultValue={p?.addressLine} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label={t('cap')} error={errors.cap}>
            <Input name="cap" inputMode="numeric" maxLength={5} defaultValue={p?.cap} />
          </Field>
          <Field label={t('city')} error={errors.city}>
            <Input name="city" defaultValue={p?.city} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('privacy')}</p>
        <Button type="submit" className="justify-self-start">
          {tc('save')}
        </Button>
      </form>
    </div>
  );
}
