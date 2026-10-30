import type { ListingCardItem } from '@accordo/shared';
import { useTranslations } from 'next-intl';
import { formatPrice, mediaSrcSet } from '@/lib/format';

export function ListingCard({ item }: { item: ListingCardItem }) {
  const t = useTranslations('Condition');
  const img = item.imageKey ? mediaSrcSet(item.imageKey) : null;
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="aspect-[4/3] bg-muted">
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
      </div>
      <div className="grid gap-1 p-3 text-sm">
        <h3 className="line-clamp-2 font-medium">{item.title}</h3>
        <p className="text-base font-semibold">{formatPrice(item.priceCents)}</p>
        <p className="text-muted-foreground">
          {t(item.condition as 'NEW')} · {item.location.comune} ({item.location.provinciaSigla})
        </p>
      </div>
    </article>
  );
}
