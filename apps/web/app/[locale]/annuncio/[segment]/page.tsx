import { parseListingPathSegment } from '@accordo/domain';
import { ApiError } from '@accordo/sdk';
import type { ListingCardItem, ListingDetail } from '@accordo/shared';
import { buttonVariants } from '@accordo/ui';
import { BadgeCheck, Handshake, MapPin, PackageCheck, ShieldCheck, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { Gallery } from '@/components/listing/gallery';
import { ShareButton } from '@/components/listing/share-button';
import { ListingCard } from '@/components/profile/listing-card';
import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

const SOLD_VISIBLE_DAYS = 30;
const path = (l: Pick<ListingDetail, 'slug' | 'shortId'>) => `/annuncio/${l.slug}-${l.shortId}`;

const load = cache(async (segment: string) => {
  const parsed = parseListingPathSegment(decodeURIComponent(segment));
  if (!parsed) notFound();
  const api = await serverApi();
  try {
    const listing = await api.get<ListingDetail>(`/api/v1/listings/${parsed.shortId}`);
    if (parsed.slug !== listing.slug) permanentRedirect(path(listing));
    const similar = await api
      .get<ListingCardItem[]>(`/api/v1/listings/${listing.id}/similar`)
      .catch(() => []);
    return { listing, similar };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

const noindex = (l: ListingDetail) =>
  l.owner !== null && !['ACTIVE', 'RESERVED', 'SOLD'].includes(l.status)
    ? true
    : l.status === 'SOLD' &&
      !!l.soldAt &&
      Date.now() - Date.parse(l.soldAt) > SOLD_VISIBLE_DAYS * 86_400_000;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/annuncio/[segment]'>): Promise<Metadata> {
  const { listing: l } = await load((await params).segment);
  const og = l.images.find((i) => i.ready);
  return {
    title: `${l.title} — ${formatPrice(l.priceCents)} | Accordo`,
    description: l.description.replace(/\s+/g, ' ').slice(0, 155),
    alternates: { canonical: path(l) },
    robots: noindex(l) ? { index: false, follow: true } : undefined,
    openGraph: {
      title: l.title,
      type: 'website',
      images: og
        ? [{ url: `${process.env.NEXT_PUBLIC_MEDIA_URL}/${og.key}/1280.jpg`, width: 1280 }]
        : [],
    },
  };
}

/** JSON-LD Product + Offer + BreadcrumbList (SPEC §12.3; no seller AggregateRating on the product). */
function jsonLd(l: ListingDetail, baseUrl: string) {
  const itemCondition =
    l.condition === 'NEW'
      ? 'https://schema.org/NewCondition'
      : l.condition === 'FOR_PARTS'
        ? 'https://schema.org/DamagedCondition'
        : 'https://schema.org/UsedCondition';
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: l.title,
      description: l.description.slice(0, 5000),
      image: l.images
        .filter((i) => i.ready)
        .map((i) => `${process.env.NEXT_PUBLIC_MEDIA_URL}/${i.key}/1280.jpg`),
      ...(l.brand ? { brand: { '@type': 'Brand', name: l.brand.name } } : {}),
      ...(l.modelName ? { model: l.modelName } : {}),
      category: `${l.category.department.name} > ${l.category.name}`,
      offers: {
        '@type': 'Offer',
        url: `${baseUrl}${path(l)}`,
        priceCurrency: 'EUR',
        price: (l.priceCents / 100).toFixed(2),
        itemCondition,
        availability:
          l.status === 'SOLD' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        seller: {
          '@type': l.sellerType === 'BUSINESS' ? 'Organization' : 'Person',
          name: l.seller.displayName,
        },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accordo', item: baseUrl },
        {
          '@type': 'ListItem',
          position: 2,
          name: l.category.department.name,
          item: `${baseUrl}/categoria/${l.category.department.slug}`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: l.category.name,
          item: `${baseUrl}/categoria/${l.category.department.slug}/${l.category.slug}`,
        },
        { '@type': 'ListItem', position: 4, name: l.title },
      ],
    },
  ];
}

export default async function ListingPage({ params }: PageProps<'/[locale]/annuncio/[segment]'>) {
  const { locale, segment } = await params;
  setRequestLocale(locale as Locale);
  const { listing: l, similar } = await load(segment);
  const t = await getTranslations('Listing');
  const tc = await getTranslations('Condition');
  const ts = await getTranslations('ListingStatus');
  const format = await getFormatter();
  const baseUrl = process.env.WEB_URL ?? 'http://localhost:3000';
  const sellerType =
    l.sellerType === 'PRIVATE'
      ? 'PRIVATE'
      : l.condition === 'NEW'
        ? 'BUSINESS_NEW'
        : 'BUSINESS_USED';
  const badges = [
    l.protectedPaymentEnabled && {
      icon: ShieldCheck,
      label: t('badges.protected'),
      tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    },
    (l.shippingIntegrated || l.shippingSelf) && { icon: PackageCheck, label: t('badges.shipping') },
    l.handDeliveryEnabled && { icon: Handshake, label: t('badges.hand') },
    l.isNegotiable && { label: t('badges.negotiable') },
    l.acceptsTrades && { label: t('badges.trades') },
  ].filter(Boolean) as Array<{ icon?: typeof ShieldCheck; label: string; tone?: string }>;
  const pct = l.seller.positivePctBps;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD built from our own data, "<" escaped
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd(l, baseUrl)).replace(/</g, '\\u003c'),
        }}
      />
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:underline">
              {t('home')}
            </Link>{' '}
            ›
          </li>
          <li>{l.category.department.name} ›</li>
          <li>{l.category.name}</li>
        </ol>
      </nav>

      {l.owner ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted p-3 text-sm">
          <span>
            {t('ownerNotice', { status: ts(l.status) })} ·{' '}
            {t('views', { count: l.owner.viewsCount })}
          </span>
          <Link
            href={`/account/annunci/${l.id}/modifica`}
            className={buttonVariants({ size: 'sm' })}
          >
            {t('edit')}
          </Link>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <Gallery images={l.images} title={l.title} />
        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">{t(`sellerType.${sellerType}`)}</p>
            <h1 className="text-2xl font-bold text-balance">{l.title}</h1>
            {l.status === 'SOLD' || l.status === 'RESERVED' ? (
              <p className="w-fit rounded-full bg-secondary px-3 py-1 text-sm font-medium">
                {l.status === 'SOLD' ? t('sold') : t('reserved')}
              </p>
            ) : null}
            <p className="text-3xl font-bold">{formatPrice(l.priceCents)}</p>
          </div>
          {badges.length ? (
            <ul aria-label={t('badges.label')} className="flex flex-wrap gap-2">
              {badges.map(({ icon: Icon, label, tone }) => (
                <li
                  key={label}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${tone ?? 'bg-secondary'}`}
                >
                  {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="flex items-center gap-1 text-sm">
            <MapPin aria-hidden className="size-4" />
            {l.location.comune} ({l.location.provinciaSigla}) · {l.location.regione}
          </p>
          {l.publishedAt ? (
            <p className="text-sm text-muted-foreground">
              {t('published', {
                date: format.dateTime(new Date(l.publishedAt), { dateStyle: 'long' }),
              })}
            </p>
          ) : null}
          <ShareButton title={l.title} />

          <section aria-labelledby="seller" className="grid gap-2 rounded-xl border p-4">
            <h2 id="seller" className="text-sm font-medium text-muted-foreground">
              {t('seller')}
            </h2>
            <p className="font-semibold">{l.seller.displayName}</p>
            <p className="flex items-center gap-1 text-sm">
              <BadgeCheck aria-hidden className="size-4 text-primary" />
              {pct === null
                ? t('noFeedback')
                : t('positive', {
                    pct: format.number(pct / 10_000, {
                      style: 'percent',
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }),
                    count: l.seller.feedbackCount,
                  })}
            </p>
            <ul className="flex flex-wrap gap-2 text-xs">
              {l.seller.topSeller ? (
                <li className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
                  <Trophy aria-hidden className="size-3" />
                  {t('topSeller')}
                </li>
              ) : null}
              {l.seller.identityVerified ? (
                <li className="rounded-full bg-secondary px-2 py-0.5">{t('identityVerified')}</li>
              ) : null}
            </ul>
            <p className="text-sm text-muted-foreground">
              {t('memberSince', {
                date: format.dateTime(new Date(l.seller.memberSince), {
                  month: 'long',
                  year: 'numeric',
                }),
              })}
            </p>
            {l.seller.shop ? (
              <p className="text-xs text-muted-foreground">
                <strong className="block text-foreground">{t('shopInfo')}</strong>
                {t('shopLegal', {
                  legalName: l.seller.shop.legalName,
                  vat: l.seller.shop.vatNumber,
                  address: l.seller.shop.address,
                })}
              </p>
            ) : null}
            {l.seller.username ? (
              <Link
                href={`/utente/${l.seller.username}`}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'justify-self-start',
                })}
              >
                {t('profile')}
              </Link>
            ) : null}
          </section>

          <section aria-labelledby="safety" className="rounded-xl bg-muted p-4 text-sm">
            <h2 id="safety" className="font-medium">
              {t('safetyTitle')}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t('safety1')}</li>
              <li>{t('safety2')}</li>
              <li>{t('safety3')}</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <section aria-labelledby="details">
            <h2 id="details" className="text-xl font-semibold">
              {t('details')}
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('condition')}</dt>
              <dd>{tc(l.condition)}</dd>
              {l.brand ? (
                <>
                  <dt className="text-muted-foreground">{t('brand')}</dt>
                  <dd>{l.brand.name}</dd>
                </>
              ) : null}
              {l.modelName ? (
                <>
                  <dt className="text-muted-foreground">{t('model')}</dt>
                  <dd>{l.modelName}</dd>
                </>
              ) : null}
              {l.year ? (
                <>
                  <dt className="text-muted-foreground">{t('year')}</dt>
                  <dd>{l.year}</dd>
                </>
              ) : null}
              {l.attributes.map((a) => (
                <div key={a.key} className="contents">
                  <dt className="text-muted-foreground">{a.label}</dt>
                  <dd>
                    {a.value}
                    {a.unit ? ` ${a.unit}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="description">
            <h2 id="description" className="text-xl font-semibold">
              {t('description')}
            </h2>
            {/* Plain text only (SPEC §13.6): rendered as text with line breaks, never as HTML. */}
            <p className="mt-3 whitespace-pre-line leading-7">{l.description}</p>
          </section>
        </div>
      </div>

      {similar.length ? (
        <section aria-labelledby="similar" className="grid gap-4">
          <h2 id="similar" className="text-xl font-semibold">
            {t('similar')}
          </h2>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {similar.map((item) => (
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
        </section>
      ) : null}
    </div>
  );
}
