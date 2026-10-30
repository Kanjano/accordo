'use client';
import type { SearchHit, SearchQuery, SearchResult } from '@accordo/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FavoriteButton } from '@/components/listing/favorite-button';
import { ListingCard } from '@/components/profile/listing-card';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { queryString } from '@/lib/search';

/** Server-rendered first page; on phones the next pages load while scrolling (SPEC §3.4). */
export function ResultsGrid({ initial, query }: { initial: SearchResult; query: SearchQuery }) {
  const t = useTranslations('Search');
  const [hits, setHits] = useState<SearchHit[]>(initial.hits);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = page < initial.totalPages;

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
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {hits.map((hit, i) => (
          <li key={hit.id} className="relative">
            <Link
              href={`/annuncio/${hit.slug}-${hit.shortId}`}
              className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
              prefetch={i < 6 ? undefined : false}
            >
              <ListingCard item={hit} />
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
