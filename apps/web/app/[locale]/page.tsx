import type { SearchResult } from '@accordo/shared';
import { buttonVariants } from '@accordo/ui';
import { Handshake, ShieldCheck, Star } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CardGrid } from '@/components/search/card-grid';
import { RecentlyViewedStrip } from '@/components/search/recently-viewed-strip';
import { loadCatalog } from '@/components/search/search-results-page';
import { Link } from '@/i18n/navigation';
import { serverApi } from '@/lib/server-api';

/** WebSite + SearchAction and Organization (SPEC §12.3). */
function jsonLd(baseUrl: string) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Accordo',
      url: baseUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${baseUrl}/annunci?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Accordo', url: baseUrl },
  ];
}

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('Home');
  // serverApi() reads the request cookies first: the page is dynamic and never fetches at build time.
  const api = await serverApi();
  const [{ departments }, recent] = await Promise.all([
    loadCatalog(),
    api.get<SearchResult>('/api/v1/search/listings?sort=newest&hitsPerPage=12').catch(() => null),
  ]);
  const pillars = [
    { icon: ShieldCheck, title: t('protectedTitle'), text: t('protectedText') },
    { icon: Star, title: t('feedbackTitle'), text: t('feedbackText') },
    { icon: Handshake, title: t('safetyTitle'), text: t('safetyText') },
  ];

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 lg:grid-cols-[15rem_1fr]">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD, "<" escaped
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd(process.env.WEB_URL ?? 'http://localhost:3000')).replace(
            /</g,
            '\\u003c',
          ),
        }}
      />

      <div className="grid min-w-0 content-start gap-8">
        <section className="grid gap-4 rounded-xl bg-muted px-5 py-6 sm:px-8">
          <div className="grid gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {t('title')}
            </h1>
            <p className="max-w-3xl text-muted-foreground text-pretty">{t('subtitle')}</p>
          </div>
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            {pillars.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-2">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <strong className="block font-semibold">{title}</strong>
                  <span className="text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/annunci" className={buttonVariants({ variant: 'outline' })}>
              {recent ? t('listingsCount', { count: recent.total }) : t('allListings')}
            </Link>
            <Link href="/vendi" className={buttonVariants()}>
              {t('sellCta')}
            </Link>
          </div>
        </section>

        {recent?.hits.length ? (
          <section aria-labelledby="recent" className="grid gap-3">
            <div className="flex items-baseline justify-between gap-2 border-b pb-2">
              <h2 id="recent" className="text-lg font-bold">
                {t('recent')}
              </h2>
              <Link href="/annunci" className="text-sm font-medium text-primary hover:underline">
                {t('allListings')} ›
              </Link>
            </div>
            <CardGrid items={recent.hits} columns="grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" />
          </section>
        ) : null}

        <RecentlyViewedStrip />

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5">
          <div>
            <h2 className="font-bold">{t('sellTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('sellText')}</p>
          </div>
          <Link href="/vendi" className={buttonVariants()}>
            {t('sellCta')}
          </Link>
        </section>
      </div>

      <nav aria-labelledby="departments" className="lg:order-first">
        <h2 id="departments" className="mb-3 text-sm font-bold tracking-wide uppercase">
          {t('browse')}
        </h2>
        <ul className="grid gap-4 text-sm max-lg:sm:grid-cols-2">
          {departments.map((d) => (
            <li key={d.id}>
              <Link
                href={`/categoria/${d.slug}`}
                className="font-semibold text-primary hover:underline"
              >
                {d.name}
              </Link>
              <ul className="mt-1 grid text-muted-foreground">
                {d.categories.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/categoria/${d.slug}/${c.slug}`}
                      className="block py-0.5 hover:text-foreground hover:underline"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
                {d.categories.length > 5 ? (
                  <li>
                    <Link
                      href={`/categoria/${d.slug}`}
                      className="block py-1 text-xs hover:text-foreground hover:underline"
                    >
                      {t('allCategories', { department: d.name })} ›
                    </Link>
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
