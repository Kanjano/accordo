'use client';
import type { SearchHit } from '@accordo/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CardGrid } from '@/components/search/card-grid';
import { api } from '@/lib/api';
import { readRecent } from '@/lib/recently-viewed';

const SYNCED = 'accordo:recently-viewed-synced';

/** First visit in a session merges the anonymous localStorage history into the account. */
export function RecentlyViewedList() {
  const t = useTranslations('RecentlyViewed');
  const { data } = useQuery({
    queryKey: ['recently-viewed'],
    queryFn: async () => {
      const local = readRecent().map((i) => i.id);
      let synced = true;
      try {
        synced = sessionStorage.getItem(SYNCED) === '1';
      } catch {
        // ignore
      }
      if (local.length && !synced) {
        await api.post('/api/v1/me/recently-viewed', { listingIds: local }).catch(() => undefined);
        try {
          sessionStorage.setItem(SYNCED, '1');
        } catch {
          // ignore
        }
      }
      return api.get<SearchHit[]>('/api/v1/me/recently-viewed');
    },
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      {data?.length ? <CardGrid items={data} columns="grid-cols-2 md:grid-cols-3" /> : null}
    </div>
  );
}
