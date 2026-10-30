import type { ListingCardItem, SearchHit } from '@accordo/shared';
import { ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { formatPrice, mediaSrcSet } from '@/lib/format';

/** Any card source; search hits add status, badges, seller rating and distance. */
export type CardItem = ListingCardItem & Partial<Omit<SearchHit, keyof ListingCardItem>>;

/** SPEC §3.4 card. */
export function ListingCard({ item }: { item: CardItem }) {
  const t = useTranslations('Condition');
  const tc = useTranslations('Card');
  const format = useFormatter();
  const img = item.imageKey ? mediaSrcSet(item.imageKey) : null;
  return (
    <article className="h-full overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-[4/3] bg-muted">
        {img ? (
          // biome-ignore lint/performance/noImgElement: variants come pre-generated from the media pipeline
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes="(min-width: 768px) 25vw, 50vw"
            alt={item.title}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
        {item.status === 'RESERVED' || item.status === 'SOLD' ? (
          <span className="absolute bottom-2 left-2 rounded bg-secondary px-2 py-0.5 text-xs font-medium">
            {item.status === 'SOLD' ? tc('sold') : tc('reserved')}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1 p-3 text-sm">
        <h3 className="line-clamp-2 font-medium">{item.title}</h3>
        <p className="text-base font-semibold">{formatPrice(item.priceCents)}</p>
        <p className="text-muted-foreground">
          {t(item.condition as 'NEW')} · {item.location.comune} ({item.location.provinciaSigla})
          {item.distanceKm !== undefined ? ` · ${tc('distance', { km: item.distanceKm })}` : ''}
        </p>
        {item.protectedPayment ? (
          <p className="flex items-center gap-1 text-xs text-emerald-800 dark:text-emerald-300">
            <ShieldCheck aria-hidden className="size-3.5" />
            {tc('protected')}
          </p>
        ) : null}
        <p className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
          {item.publishedAt ? (
            <time dateTime={item.publishedAt}>
              {/* Absolute date: stable between server and client render (no hydration drift). */}
              {format.dateTime(new Date(item.publishedAt), { day: 'numeric', month: 'short' })}
            </time>
          ) : null}
          {item.sellerPositivePctBps != null ? (
            <span>
              {tc('positive', {
                pct: format.number(item.sellerPositivePctBps / 10_000, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
