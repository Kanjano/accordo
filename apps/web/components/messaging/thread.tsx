'use client';
import {
  type ConversationDetail,
  MESSAGE_REPORT_REASONS,
  type MessageItem,
  type OfferItem,
  type Page,
} from '@accordo/shared';
import { Alert, Button, cn, Label, Textarea } from '@accordo/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { formatPrice } from '@/lib/format';
import { useRealtimeConnected } from '@/lib/realtime';
import { useErrorMessage } from '@/lib/use-error-message';
import { OfferForm } from './offer-form';

const MASK = '[contatto nascosto]';

export function Thread({ id }: { id: string }) {
  const t = useTranslations('Messages');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const connected = useRealtimeConnected();
  const { data: session } = useSession();
  const me = session?.user.id;
  const poll = connected ? false : 5000;

  const { data: c, error: loadError } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/api/v1/conversations/${id}`),
    refetchInterval: poll,
  });
  const messages = useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) =>
      api.get<Page<MessageItem>>(
        `/api/v1/conversations/${id}/messages${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: poll,
  });
  const items = (messages.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();
  const newest = items.at(-1);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['conversation', id] });
    void qc.invalidateQueries({ queryKey: ['messages', id] });
  };

  // Reading the thread marks the other party's messages as read.
  const newestId = newest?.id;
  const newestFromOther = !!newest && newest.senderId !== me && !newest.readAt;
  useEffect(() => {
    if (!newestId || !newestFromOther) return;
    void api.post(`/api/v1/conversations/${id}/read`).then(() => {
      void qc.invalidateQueries({ queryKey: ['conversations-unread'] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });
  }, [id, newestId, newestFromOther, qc]);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (newestId) bottom.current?.scrollIntoView({ block: 'end' });
  }, [newestId]);

  if (loadError) return <Alert tone="error">{errorMessage(loadError)}</Alert>;
  if (!c || !me) return <p className="text-muted-foreground">{t('loading')}</p>;

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <Link href="/messaggi" className="flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          {t('back')}
        </Link>
        <h1 className="text-xl font-bold">{t('with', { name: c.otherParty.name })}</h1>
        <p className="text-sm">
          <Link
            href={`/annuncio/${c.listing.slug}-${c.listing.shortId}`}
            className="underline underline-offset-4"
          >
            {c.listing.title}
          </Link>{' '}
          · {formatPrice(c.listing.priceCents)}
        </p>
        <ThreadActions conversation={c} onChange={refresh} />
      </header>

      <aside className="flex gap-2 rounded-lg bg-muted p-3 text-sm" aria-label={t('safetyLabel')}>
        <ShieldAlert aria-hidden className="size-5 shrink-0 text-primary" />
        <p>
          {t('safety1')} {t('safety2')}
        </p>
      </aside>

      <OfferPanel conversation={c} me={me} onChange={refresh} />

      <section aria-label={t('history')} className="grid gap-3">
        {messages.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-center"
            onClick={() => messages.fetchNextPage()}
          >
            {t('older')}
          </Button>
        ) : null}
        <ol className="grid gap-3" aria-live="polite">
          {items.map((m) => (
            <li key={m.id}>
              <Bubble message={m} mine={m.senderId === me} />
            </li>
          ))}
        </ol>
        <div ref={bottom} />
      </section>

      {c.blocked ? (
        <Alert>{t('blocked')}</Alert>
      ) : (
        <Composer conversationId={id} onSent={refresh} />
      )}
    </div>
  );
}

function Bubble({ message: m, mine }: { message: MessageItem; mine: boolean }) {
  const t = useTranslations('Messages');
  const format = useFormatter();
  const time = format.dateTime(new Date(m.createdAt), { dateStyle: 'short', timeStyle: 'short' });
  if (m.type === 'OFFER' && m.offer) {
    return (
      <p className="mx-auto w-fit rounded-full bg-secondary px-3 py-1 text-center text-xs">
        {t(`offerEvent.${(m.body ?? 'created') as 'created'}`)} ·{' '}
        <strong>{formatPrice(m.offer.amountCents)}</strong> ·{' '}
        <time dateTime={m.createdAt}>{time}</time>
      </p>
    );
  }
  return (
    <div className={cn('grid max-w-[85%] gap-1', mine ? 'ml-auto justify-items-end' : '')}>
      {/* Plain text only: links are never clickable (SPEC §13.4). */}
      <p
        className={cn(
          'whitespace-pre-wrap break-words rounded-2xl px-4 py-2',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {m.body}
      </p>
      {m.body?.includes(MASK) ? (
        <p className="text-xs text-muted-foreground">{t('maskedNote')}</p>
      ) : null}
      {m.warn && !mine ? (
        <Alert tone="error">
          <strong>{t('warnTitle')}</strong> {t('warnText')}
        </Alert>
      ) : null}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <time dateTime={m.createdAt}>{time}</time>
        {mine && m.readAt ? <span>· {t('read')}</span> : null}
        {!mine ? <ReportMessage messageId={m.id} /> : null}
      </div>
    </div>
  );
}

function ReportMessage({ messageId }: { messageId: string }) {
  const t = useTranslations('Messages');
  const id = useId();
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<string>('SCAM');
  if (done) return <span role="status">{t('reported')}</span>;
  return (
    <details>
      <summary className="cursor-pointer underline">{t('report')}</summary>
      <div className="mt-1 flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={id} className="text-xs">
            {t('reportReason')}
          </Label>
          <select
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 rounded border bg-background px-2"
          >
            {MESSAGE_REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reason.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await api.post(`/api/v1/messages/${messageId}/report`, { reasonCode: reason });
            setDone(true);
          }}
        >
          {t('send')}
        </Button>
      </div>
    </details>
  );
}

function Composer({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const t = useTranslations('Messages');
  const errorMessage = useErrorMessage();
  const id = useId();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/conversations/${conversationId}/messages`, { body });
      setBody('');
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Label htmlFor={id} className="sr-only">
        {t('composer')}
      </Label>
      <Textarea
        id={id}
        rows={3}
        maxLength={2000}
        value={body}
        placeholder={t('composerPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !body.trim()} className="justify-self-end">
        {t('send')}
      </Button>
    </form>
  );
}

function ThreadActions({
  conversation: c,
  onChange,
}: {
  conversation: ConversationDetail;
  onChange: () => void;
}) {
  const t = useTranslations('Messages');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {c.otherParty.username ? (
        <Link
          href={`/utente/${c.otherParty.username}`}
          className="text-sm underline underline-offset-4"
        >
          {t('profile')}
        </Link>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          run(() =>
            api.post(`/api/v1/conversations/${c.id}/${c.archived ? 'unarchive' : 'archive'}`),
          )
        }
      >
        {c.archived ? t('unarchive') : t('archive')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          (c.blocked || window.confirm(t('blockConfirm'))) &&
          run(() =>
            c.blocked
              ? api.delete(`/api/v1/users/${c.otherParty.id}/block`)
              : api.put(`/api/v1/users/${c.otherParty.id}/block`),
          )
        }
      >
        {c.blocked ? t('unblock') : t('block')}
      </Button>
    </div>
  );
}

function OfferPanel({
  conversation: c,
  me,
  onChange,
}: {
  conversation: ConversationDetail;
  me: string;
  onChange: () => void;
}) {
  const t = useTranslations('Offers');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const pending = c.offers.filter((o) => o.status === 'PENDING');
  const accepted = c.offers.find((o) => o.status === 'ACCEPTED');
  const canOffer =
    c.role === 'BUYER' &&
    !c.blocked &&
    c.listing.status === 'ACTIVE' &&
    c.listing.isNegotiable &&
    c.listing.protectedPaymentEnabled;
  const act = async (offer: OfferItem, action: string, amountCents?: number) => {
    setError(null);
    try {
      await api.post(`/api/v1/offers/${offer.id}/${action}`, amountCents ? { amountCents } : {});
      onChange();
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  };
  if (!pending.length && !accepted && !canOffer) return null;

  return (
    <section aria-labelledby="offers" className="grid gap-3 rounded-xl border p-4">
      <h2 id="offers" className="font-semibold">
        {t('title')}
      </h2>
      {accepted ? (
        <Alert tone="success">
          {t('accepted', {
            amount: formatPrice(accepted.amountCents),
            until: format.dateTime(new Date(accepted.expiresAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </Alert>
      ) : null}
      {pending.map((o) => {
        const mine = o.proposedById === me;
        return (
          <div key={o.id} className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
            <p>
              {mine ? t('yourOffer') : t('theirOffer')}:{' '}
              <strong>{formatPrice(o.amountCents)}</strong> ·{' '}
              {t('expires', {
                at: format.dateTime(new Date(o.expiresAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </p>
            {mine ? (
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => act(o, 'withdraw').catch(() => undefined)}
              >
                {t('withdraw')}
              </Button>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => act(o, 'accept').catch(() => undefined)}>
                    {t('accept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(o, 'decline').catch(() => undefined)}
                  >
                    {t('decline')}
                  </Button>
                </div>
                <OfferForm
                  priceCents={c.listing.priceCents}
                  label={t('counterLabel')}
                  submitLabel={t('counter')}
                  onSubmit={(amount) => act(o, 'counter', amount)}
                />
              </>
            )}
          </div>
        );
      })}
      {canOffer && !accepted ? (
        <OfferForm
          priceCents={c.listing.priceCents}
          label={t('makeLabel')}
          submitLabel={t('make')}
          onSubmit={async (amountCents) => {
            await api.post(`/api/v1/listings/${c.listing.id}/offers`, { amountCents });
            onChange();
          }}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
