'use client';
import type { OfferItem } from '@accordo/shared';
import { Button, buttonVariants, Label, Textarea } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { OfferForm } from './offer-form';

/** "Contatta il venditore" and "Fai un'offerta" on the listing page (SPEC §3.5–3.6). */
export function ContactSeller({
  listingId,
  priceCents,
  canOffer,
}: {
  listingId: string;
  priceCents: number;
  canOffer: boolean;
}) {
  const t = useTranslations('Messages');
  const to = useTranslations('Offers');
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [mode, setMode] = useState<'none' | 'message' | 'offer'>('none');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return null;
  if (!session)
    return (
      <Link
        href={`/accedi?next=${encodeURIComponent(pathname)}`}
        className={buttonVariants({ className: 'justify-self-start' })}
      >
        {t('signInToContact')}
      </Link>
    );

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id: conversationId } = await api.post<{ id: string }>('/api/v1/conversations', {
        listingId,
        body,
      });
      router.push(`/messaggi/${conversationId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={mode === 'message' ? 'secondary' : 'default'}
          aria-expanded={mode === 'message'}
          onClick={() => setMode(mode === 'message' ? 'none' : 'message')}
        >
          {t('contact')}
        </Button>
        {canOffer ? (
          <Button
            variant="outline"
            aria-expanded={mode === 'offer'}
            onClick={() => setMode(mode === 'offer' ? 'none' : 'offer')}
          >
            {to('make')}
          </Button>
        ) : null}
      </div>
      {mode === 'message' ? (
        <form onSubmit={send} className="grid gap-2">
          <Label htmlFor={id}>{t('firstMessage')}</Label>
          <Textarea
            id={id}
            rows={3}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('firstMessagePlaceholder')}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !body.trim()} className="justify-self-start">
            {t('send')}
          </Button>
        </form>
      ) : null}
      {mode === 'offer' ? (
        <OfferForm
          priceCents={priceCents}
          label={to('makeLabel')}
          submitLabel={to('make')}
          onSubmit={async (amountCents) => {
            const offer = await api.post<OfferItem & { conversationId: string }>(
              `/api/v1/listings/${listingId}/offers`,
              { amountCents },
            );
            router.push(`/messaggi/${offer.conversationId}`);
          }}
        />
      ) : null}
    </div>
  );
}
