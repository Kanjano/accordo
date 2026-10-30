import type { SearchResult } from '@accordo/shared';
import { buttonVariants } from '@accordo/ui';
import { Handshake, ShieldCheck, Star } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CardGrid } from '@/components/search/card-grid';
import { RecentlyViewedStrip } from '@/components/search/recently-viewed-strip';
import { SearchBox } from '@/components/search/search-box';
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
    api.get<SearchResult>('/api/v1/search/listings?sort=newest&hitsPerPage=8').catch(() => null),
  ]);
  const pillars = [
    { icon: ShieldCheck, title: t('protectedTitle'), text: t('protectedText') },
    { icon: Star, title: t('feedbackTitle'), text: t('feedbackText') },
    { icon: Handshake, title: t('safetyTitle'), text: t('safetyText') },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-4 py-12 sm:py-16">
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
      <section className="grid max-w-3xl gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">{t('title')}</h1>
        <p className="text-lg text-muted-foreground text-pretty">{t('subtitle')}</p>
        <SearchBox className="max-w-xl" />
      </section>

      <section aria-labelledby="departments" className="grid gap-4">
        <h2 id="departments" className="text-xl font-semibold">
          {t('departments')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {departments.map((d) => (
            <li key={d.id}>
              <Link
                href={`/categoria/${d.slug}`}
                className="block rounded-xl border bg-card p-4 font-medium hover:bg-accent"
              >
                {d.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {recent?.hits.length ? (
        <section aria-labelledby="recent" className="grid gap-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="recent" className="text-xl font-semibold">
              {t('recent')}
            </h2>
            <Link href="/annunci" className="text-sm underline underline-offset-4">
              {t('allListings')}
            </Link>
          </div>
          <CardGrid items={recent.hits} />
        </section>
      ) : null}

      <RecentlyViewedStrip />

      <section aria-labelledby="pillars">
        <h2 id="pillars" className="sr-only">
          {t('pillars')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {pillars.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border bg-card p-6">
              <Icon aria-hidden className="size-6 text-primary" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid justify-items-start gap-3 rounded-xl bg-muted p-6">
        <h2 className="text-xl font-semibold">{t('sellTitle')}</h2>
        <p className="text-muted-foreground">{t('sellText')}</p>
        <Link href="/vendi" className={buttonVariants()}>
          {t('sellCta')}
        </Link>
      </section>
    </div>
  );
}
