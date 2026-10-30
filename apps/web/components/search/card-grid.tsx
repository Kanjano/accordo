'use client';
import { FavoriteButton } from '@/components/listing/favorite-button';
import { type CardItem, ListingCard } from '@/components/profile/listing-card';
import { Link } from '@/i18n/navigation';

/** Plain grid of listing cards with the favorite toggle (account pages, home). */
export function CardGrid({
  items,
  columns = 'grid-cols-2 md:grid-cols-4',
}: {
  items: CardItem[];
  columns?: string;
}) {
  return (
    <ul className={`grid gap-4 ${columns}`}>
      {items.map((item) => (
        <li key={item.id} className="relative">
          <Link
            href={`/annuncio/${item.slug}-${item.shortId}`}
            className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ListingCard item={item} />
          </Link>
          <FavoriteButton
            listingId={item.id}
            title={item.title}
            className="absolute top-2 right-2"
          />
        </li>
      ))}
    </ul>
  );
}
