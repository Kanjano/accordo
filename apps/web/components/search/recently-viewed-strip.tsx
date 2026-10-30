'use client';
import type { ListingCardItem } from '@accordo/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { readRecent } from '@/lib/recently-viewed';
import { CardGrid } from './card-grid';

/** Home strip from localStorage: works for anonymous visitors too. */
export function RecentlyViewedStrip() {
  const t = useTranslations('Home');
  const [items, setItems] = useState<ListingCardItem[]>([]);
  useEffect(() => setItems(readRecent().slice(0, 4)), []);
  if (!items.length) return null;
  return (
    <section aria-labelledby="recently-viewed" className="grid gap-4">
      <h2 id="recently-viewed" className="text-xl font-semibold">
        {t('recentlyViewed')}
      </h2>
      <CardGrid items={items} />
    </section>
  );
}
