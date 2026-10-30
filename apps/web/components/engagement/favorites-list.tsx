'use client';
import type { SearchHit } from '@accordo/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CardGrid } from '@/components/search/card-grid';
import { api } from '@/lib/api';

export function FavoritesList() {
  const t = useTranslations('Favorites');
  const { data } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api.get<SearchHit[]>('/api/v1/me/favorites'),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      {data?.length ? <CardGrid items={data} columns="grid-cols-2 md:grid-cols-3" /> : null}
    </div>
  );
}
