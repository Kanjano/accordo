'use client';
import { Button, Checkbox } from '@accordo/ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import {
  CONSENT_CHANGED_EVENT,
  CONSENT_COOKIE,
  CONSENT_OPEN_EVENT,
  CONSENT_VERSION,
  parseConsent,
  readCookieValue,
  serializeConsent,
} from '@/lib/consent';

/** Garante-compliant banner: equal Accept/Reject, granular choice unticked by default, X = reject. */
export function CookieBanner() {
  const t = useTranslations('Consent');
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const current = parseConsent(readCookieValue(document.cookie, CONSENT_COOKIE));
    setOpen(!current);
    setAnalytics(current?.analytics ?? false);
    const reopen = () => {
      setCustomize(true);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  function choose(allowAnalytics: boolean) {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available in every supported browser
    document.cookie = serializeConsent(allowAnalytics);
    void api
      .post('/api/v1/consents', { version: CONSENT_VERSION, analytics: allowAnalytics })
      .catch(() => undefined);
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
    setOpen(false);
  }

  if (!open) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-md sm:rounded-xl sm:border"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="font-semibold">
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={() => choose(false)}
          aria-label={t('close')}
          className="rounded-md p-1 hover:bg-accent"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('text')}{' '}
        <Link href="/cookie" className="underline underline-offset-4">
          {t('policy')}
        </Link>
      </p>
      {customize ? (
        <fieldset className="mt-4 grid gap-3 text-sm">
          <label className="flex gap-3">
            <Checkbox checked disabled />
            <span>
              <strong>{t('necessary')}</strong> — {t('necessaryText')}
            </span>
          </label>
          <label className="flex gap-3">
            <Checkbox checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <span>
              <strong>{t('analytics')}</strong> — {t('analyticsText')}
            </span>
          </label>
        </fieldset>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => choose(false)}>{t('reject')}</Button>
        <Button onClick={() => choose(true)}>{t('accept')}</Button>
        {customize ? (
          <Button variant="outline" className="col-span-2" onClick={() => choose(analytics)}>
            {t('save')}
          </Button>
        ) : (
          <Button variant="link" className="col-span-2" onClick={() => setCustomize(true)}>
            {t('customize')}
          </Button>
        )}
      </div>
    </section>
  );
}

export function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      {label}
    </button>
  );
}
