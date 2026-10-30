'use client';
import { Button, Input, Label } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { formatPrice } from '@/lib/format';
import { parseEuroToCents } from '@/lib/price';
import { useErrorMessage } from '@/lib/use-error-message';

/** Amount in euros → cents, with the SPEC §3.6 range shown as a hint (the API re-validates). */
export function OfferForm({
  priceCents,
  minPercent = 50,
  label,
  submitLabel,
  onSubmit,
}: {
  priceCents: number;
  minPercent?: number;
  label: string;
  submitLabel: string;
  onSubmit: (amountCents: number) => Promise<unknown>;
}) {
  const t = useTranslations('Offers');
  const errorMessage = useErrorMessage();
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const min = Math.ceil((priceCents * minPercent) / 100);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseEuroToCents(value);
    if (cents === null || cents < min || cents > priceCents) {
      setError(t('range', { min: formatPrice(min), max: formatPrice(priceCents) }));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(cents);
      setValue('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="decimal"
          placeholder={t('placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={`${id}-hint`}
          aria-invalid={!!error}
          className="max-w-40"
        />
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t('range', { min: formatPrice(min), max: formatPrice(priceCents) })}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
