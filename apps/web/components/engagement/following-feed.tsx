'use client';
import type { FollowedUser, Page, SearchHit } from '@accordo/shared';
import { Button } from '@accordo/ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CardGrid } from '@/components/search/card-grid';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function FollowingFeed() {
  const t = useTranslations('Following');
  const { data: users } = useQuery({
    queryKey: ['following'],
    queryFn: () => api.get<FollowedUser[]>('/api/v1/me/following'),
  });
  const feed = useInfiniteQuery({
    queryKey: ['following-feed'],
    queryFn: ({ pageParam }) =>
      api.get<Page<SearchHit>>(
        `/api/v1/me/feed/following${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <section aria-labelledby="followed-users" className="grid gap-2">
        <h2 id="followed-users" className="font-semibold">
          {t('users', { count: users?.length ?? 0 })}
        </h2>
        {users && !users.length ? <p className="text-muted-foreground">{t('noUsers')}</p> : null}
        <ul className="flex flex-wrap gap-2 text-sm">
          {users?.map((u) =>
            u.username ? (
              <li key={u.id}>
                <Link
                  href={`/utente/${u.username}`}
                  className="rounded-full border px-3 py-1 hover:bg-accent"
                >
                  {u.name}
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      </section>
      <section aria-labelledby="feed" className="grid gap-4">
        <h2 id="feed" className="font-semibold">
          {t('feed')}
        </h2>
        {feed.data && !items.length ? (
          <p className="text-muted-foreground">{t('emptyFeed')}</p>
        ) : null}
        {items.length ? <CardGrid items={items} columns="grid-cols-2 md:grid-cols-3" /> : null}
        {feed.hasNextPage ? (
          <Button
            variant="outline"
            className="justify-self-center"
            disabled={feed.isFetchingNextPage}
            onClick={() => feed.fetchNextPage()}
          >
            {t('more')}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
