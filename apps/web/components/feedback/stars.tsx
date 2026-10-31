'use client';
import { cn } from '@accordo/ui';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

/** 1–5 stars as an accessible radio group (SPEC §12.2: `FeedbackForm`). */
export function StarsInput({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  const t = useTranslations('Feedback');
  const id = useId();
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative cursor-pointer">
            <input
              type="radio"
              name={id}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              // Transparent over the star: real hit area for pointer, keyboard and tests.
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <Star
              aria-hidden
              className={cn(
                'size-7 peer-focus-visible:outline-2 peer-focus-visible:outline-ring',
                value !== null && n <= value
                  ? 'fill-amber-500 text-amber-600'
                  : 'text-muted-foreground',
              )}
            />
            <span className="sr-only">{t('stars', { count: n })}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StarsValue({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-3.5',
            n <= Math.round(value) ? 'fill-amber-500 text-amber-600' : 'text-muted-foreground',
          )}
        />
      ))}
    </span>
  );
}
