import { ShieldCheck, Store, Trophy, Truck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CardItem } from '@/components/profile/listing-card';
import { formatPrice, mediaSrcSet } from '@/lib/format';

/** Compact list row: many results per screen, details at a glance. */
export function ListingRow({ item }: { item: CardItem }) {
  const t = useTranslations('Condition');
  const tc = useTranslations('Card');
  const ts = useTranslations('Search');
  const format = useFormatter();
  const img = item.imageKey ? mediaSrcSet(item.imageKey) : null;
  return (
    <article className="flex h-full gap-3 rounded-lg border bg-card p-2 sm:gap-4">
      <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-md bg-muted sm:w-44">
        {img ? (
          // biome-ignore lint/performance/noImgElement: variants come pre-generated from the media pipeline
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes="(min-width: 640px) 176px, 112px"
            alt={item.title}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
        {item.status === 'RESERVED' || item.status === 'SOLD' ? (
          <span className="absolute bottom-1 left-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
            {item.status === 'SOLD' ? tc('sold') : tc('reserved')}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5 pr-9 text-sm sm:flex-row sm:gap-4">
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <h3 className="line-clamp-2 font-semibold text-primary sm:text-base">{item.title}</h3>
          <p className="text-muted-foreground">
            {t(item.condition as 'NEW')} · {item.location.comune} ({item.location.provinciaSigla})
            {item.distanceKm !== undefined ? ` · ${tc('distance', { km: item.distanceKm })}` : ''}
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {item.protectedPayment ? (
              <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                <ShieldCheck aria-hidden className="size-3.5" />
                {tc('protected')}
              </span>
            ) : null}
            {item.shippingAvailable ? (
              <span className="inline-flex items-center gap-1">
                <Truck aria-hidden className="size-3.5" />
                {ts('flag.shipping')}
              </span>
            ) : null}
            {item.sellerType === 'BUSINESS' ? (
              <span className="inline-flex items-center gap-1">
                <Store aria-hidden className="size-3.5" />
                {ts('seller.BUSINESS')}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:grid sm:content-start sm:justify-items-end sm:text-right">
          <p className="text-lg font-bold whitespace-nowrap">{formatPrice(item.priceCents)}</p>
          <p className="grid gap-0.5 text-xs text-muted-foreground sm:justify-items-end">
            {item.publishedAt ? (
              <time dateTime={item.publishedAt}>
                {format.dateTime(new Date(item.publishedAt), { day: 'numeric', month: 'short' })}
              </time>
            ) : null}
            {item.sellerPositivePctBps != null ? (
              <span className="inline-flex items-center gap-1 max-sm:hidden">
                {item.isTopSeller ? (
                  <Trophy aria-label={tc('topSeller')} className="size-3.5 text-amber-600" />
                ) : null}
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
      </div>
    </article>
  );
}
