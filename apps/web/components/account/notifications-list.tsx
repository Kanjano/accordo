'use client';
import type { NotificationItem, Page } from '@accordo/shared';
import { Button, cn } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function NotificationsList() {
  const t = useTranslations('Notifications');
  const format = useFormatter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Page<NotificationItem>>('/api/v1/me/notifications'),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/api/v1/me/notifications/read', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });
  const items = data?.items ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={!items.some((n) => !n.readAt) || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {t('markAll')}
        </Button>
      </div>
      {data && !items.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-2">
        {items.map((n) => {
          const path = typeof n.data?.path === 'string' ? n.data.path : null;
          return (
            <li
              key={n.id}
              className={cn('rounded-lg border p-4', !n.readAt && 'border-primary/40 bg-accent/40')}
            >
              <p className="font-medium">{n.title}</p>
              <p className="text-sm">{n.body}</p>
              <p className="mt-1 flex gap-3 text-xs text-muted-foreground">
                {format.relativeTime(new Date(n.createdAt))}
                {path ? (
                  <Link href={path} className="text-primary underline underline-offset-4">
                    {t('open')}
                  </Link>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Unread count for the header bell (real-time push arrives with WebSockets in Phase 5). */
export function useUnreadNotifications() {
  const t = useTranslations('Notifications');
  const { data } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get<{ count: number }>('/api/v1/me/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  return { count, label: t('bell', { count }) };
}
