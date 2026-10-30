'use client';
import type { ConversationSummary, Page } from '@accordo/shared';
import { Button, cn } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { mediaSrcSet } from '@/lib/format';
import { useRealtimeConnected } from '@/lib/realtime';
import { useMessagePreview } from './message-text';

export function ConversationList() {
  const t = useTranslations('Messages');
  const format = useFormatter();
  const preview = useMessagePreview();
  const { data: session } = useSession();
  const connected = useRealtimeConnected();
  const [archived, setArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ['conversations', archived],
    queryFn: () => api.get<Page<ConversationSummary>>(`/api/v1/conversations?archived=${archived}`),
    refetchInterval: connected ? false : 15_000,
  });
  const items = data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{archived ? t('archivedTitle') : t('title')}</h1>
        <Button variant="ghost" size="sm" onClick={() => setArchived((a) => !a)}>
          {archived ? t('showInbox') : t('showArchived')}
        </Button>
      </div>
      {data && !items.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-2">
        {items.map((c) => {
          const img = c.listing.imageKey ? mediaSrcSet(c.listing.imageKey) : null;
          return (
            <li key={c.id}>
              <Link
                href={`/messaggi/${c.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 hover:bg-accent',
                  c.unread > 0 && 'border-primary',
                )}
              >
                <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {img ? (
                    // biome-ignore lint/performance/noImgElement: pre-generated media variants
                    <img src={img.src} alt="" className="size-full object-cover" />
                  ) : null}
                </div>
                <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                  <p className="flex justify-between gap-2">
                    <span className="truncate font-medium">{c.otherParty.name}</span>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={c.lastMessageAt}
                    >
                      {format.dateTime(new Date(c.lastMessageAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </time>
                  </p>
                  <p className="truncate text-muted-foreground">
                    {c.role === 'BUYER' ? t('buying') : t('selling')} · {c.listing.title}
                  </p>
                  <p className={cn('truncate', c.unread > 0 && 'font-semibold')}>
                    {c.lastMessage ? preview(c.lastMessage, session?.user.id) : ''}
                  </p>
                </div>
                {c.unread > 0 ? (
                  <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
                    <span className="sr-only">{t('unread', { count: c.unread })}</span>
                    <span aria-hidden>{c.unread}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
