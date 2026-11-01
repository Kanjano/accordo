'use client';
import type { SearchHit, SearchQuery, SearchResult } from '@accordo/shared';
import { cn } from '@accordo/ui';
import { LayoutGrid, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FavoriteButton } from '@/components/listing/favorite-button';
import { ListingCard } from '@/components/profile/listing-card';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { queryString } from '@/lib/search';
import { ListingRow } from './listing-row';

type View = 'list' | 'grid';
const VIEW_KEY = 'accordo:results-view';

/** Server-rendered first page; on phones the next pages load while scrolling (SPEC §3.4). */
export function ResultsGrid({ initial, query }: { initial: SearchResult; query: SearchQuery }) {
  const t = useTranslations('Search');
  const [hits, setHits] = useState<SearchHit[]>(initial.hits);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = page < initial.totalPages;
  // Dense list by default; the grid choice is a per-browser convenience.
  const [view, setView] = useState<View>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'grid') setView('grid');
    } catch {}
  }, []);
  function choose(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || !window.matchMedia('(max-width: 639px)').matches) return;
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry?.isIntersecting || loading) return;
      setLoading(true);
      try {
        const next = await api.get<SearchResult>(
          `/api/v1/search/listings${queryString({ ...query, page: String(page + 1) })}`,
        );
        setHits((h) => [...h, ...next.hits]);
        setPage(next.page);
      } finally {
        setLoading(false);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, page, loading, query]);

  return (
    <>
      <fieldset className="flex items-center justify-end gap-1 text-sm">
        <legend className="sr-only">{t('view')}</legend>
        {(
          [
            ['list', List, t('viewList')],
            ['grid', LayoutGrid, t('viewGrid')],
          ] as const
        ).map(([v, Icon, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => choose(v)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent',
              view === v && 'bg-accent font-medium',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </fieldset>
      <ul
        className={
          view === 'list' ? 'grid gap-2' : 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4'
        }
      >
        {hits.map((hit, i) => (
          <li key={hit.id} className="relative">
            <Link
              href={`/annuncio/${hit.slug}-${hit.shortId}`}
              className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
              prefetch={i < 6 ? undefined : false}
            >
              {view === 'list' ? <ListingRow item={hit} /> : <ListingCard item={hit} />}
            </Link>
            <FavoriteButton
              listingId={hit.id}
              title={hit.title}
              className="absolute top-2 right-2"
            />
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-live="polite" className="py-2 text-center text-sm sm:hidden">
        {loading ? t('loadingMore') : ''}
      </div>
    </>
  );
}
