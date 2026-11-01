import { ApiError } from '@accordo/sdk';
import type { ListingCardItem, Page, ShopPublic } from '@accordo/shared';
import { BadgeCheck, Store } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { ListingCard } from '@/components/profile/listing-card';
import { Link } from '@/i18n/navigation';
import { mediaSrcSet } from '@/lib/format';
import { cachedApi } from '@/lib/server-api';

const load = cache(async (slug: string) => {
  const api = cachedApi();
  try {
    const shop = await api.get<ShopPublic>(`/api/v1/shops/${encodeURIComponent(slug)}`);
    const listings = shop.ownerUsername
      ? await api.get<Page<ListingCardItem>>(
          `/api/v1/users/${encodeURIComponent(shop.ownerUsername)}/listings?limit=24`,
        )
      : { items: [], nextCursor: null };
    return { shop, listings };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/negozio/[slug]'>): Promise<Metadata> {
  const { shop } = await load((await params).slug);
  return {
    title: `${shop.name} — ${shop.comune} | Accordo`,
    description: shop.description?.slice(0, 155),
    alternates: { canonical: `/negozio/${shop.slug}` },
  };
}

/** Storefront with the legal data (SPEC §3.8, §14.2). */
export default async function ShopPage({ params }: PageProps<'/[locale]/negozio/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('Shops');
  const { shop: s, listings } = await load(slug);
  const legal: Array<[string, string | null]> = [
    [t('fields.legalName'), s.legal.legalName],
    [t('fields.vatNumber'), s.legal.vatNumber],
    [t('fields.reaNumber'), s.legal.reaNumber],
    [t('fields.addressLine'), s.legal.address],
    [t('fields.email'), s.legal.email],
    [t('fields.phone'), s.legal.phone],
    [t('fields.pec'), s.legal.pec],
  ];
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <section className="overflow-hidden rounded-xl border bg-card">
        {s.coverKey ? (
          // biome-ignore lint/performance/noImgElement: pre-generated variants on the media CDN
          <img
            {...mediaSrcSet(s.coverKey)}
            sizes="(min-width: 1152px) 1152px, 100vw"
            alt=""
            className="h-40 w-full object-cover md:h-56"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-4 p-6">
          {s.logoKey ? (
            // biome-ignore lint/performance/noImgElement: pre-generated variants on the media CDN
            <img src={mediaSrcSet(s.logoKey).src} alt="" className="size-20 rounded object-cover" />
          ) : (
            <span className="grid size-20 place-items-center rounded bg-muted">
              <Store aria-hidden className="size-8" />
            </span>
          )}
          <div className="grid gap-1">
            <h1 className="text-2xl font-bold">{s.name}</h1>
            <p className="text-sm text-muted-foreground">
              {s.comune} ({s.provinciaSigla}) · {s.regione}
            </p>
            <p className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
                <BadgeCheck aria-hidden className="size-3.5" />
                {t('verifiedBadge')}
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5">{t('professional')}</span>
            </p>
          </div>
          <div className="ml-auto grid justify-items-end gap-1 text-sm">
            {s.ownerUsername ? (
              <Link href={`/utente/${s.ownerUsername}`} className="underline">
                {t('profileAndFeedback')}
              </Link>
            ) : null}
            <Link
              href={`/segnala?tipo=SHOP&id=${s.slug}`}
              className="text-muted-foreground underline"
            >
              {t('report')}
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-6">
          {s.description ? (
            <section aria-labelledby="about">
              <h2 id="about" className="text-xl font-semibold">
                {t('about')}
              </h2>
              <p className="mt-2 whitespace-pre-line">{s.description}</p>
            </section>
          ) : null}
          <section aria-labelledby="listings" className="grid gap-4">
            <h2 id="listings" className="text-xl font-semibold">
              {t('activeListings', { count: s.activeListings })}
            </h2>
            {listings.items.length ? (
              <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {listings.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/annuncio/${item.slug}-${item.shortId}`}
                      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ListingCard item={item} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('noListings')}</p>
            )}
          </section>
        </div>
        <aside className="grid content-start gap-4 text-sm">
          {s.openingHours ? (
            <section aria-labelledby="hours" className="rounded-xl border p-4">
              <h2 id="hours" className="font-semibold">
                {t('fields.openingHours')}
              </h2>
              <p className="mt-1 whitespace-pre-line">{s.openingHours}</p>
            </section>
          ) : null}
          <section aria-labelledby="legal" className="rounded-xl border p-4">
            <h2 id="legal" className="font-semibold">
              {t('legalInfo')}
            </h2>
            <dl className="mt-2 grid gap-1">
              {legal.map(([k, v]) =>
                v ? (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ) : null,
              )}
              {s.website ? (
                <div>
                  <dt className="text-muted-foreground">{t('fields.website')}</dt>
                  <dd>
                    <a
                      href={s.website}
                      rel="nofollow noopener noreferrer"
                      target="_blank"
                      className="underline"
                    >
                      {s.website}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section aria-labelledby="rights" className="rounded-xl bg-muted p-4">
            <h2 id="rights" className="font-semibold">
              {t('consumerRights')}
            </h2>
            <p className="mt-1">{t('consumerRightsText')}</p>
            {s.legal.returnPolicy ? (
              <>
                <h3 className="mt-3 font-medium">{t('fields.returnPolicy')}</h3>
                <p className="whitespace-pre-line">{s.legal.returnPolicy}</p>
              </>
            ) : null}
            {s.legal.warrantyInfo ? (
              <>
                <h3 className="mt-3 font-medium">{t('fields.warrantyInfo')}</h3>
                <p className="whitespace-pre-line">{s.legal.warrantyInfo}</p>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
