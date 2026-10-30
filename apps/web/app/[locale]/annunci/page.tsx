import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchResultsPage } from '@/components/search/search-results-page';
import { toQuery } from '@/lib/search';

export async function generateMetadata({
  searchParams,
}: PageProps<'/[locale]/annunci'>): Promise<Metadata> {
  const t = await getTranslations('Search');
  const { q } = toQuery(await searchParams);
  return {
    title: `${typeof q === 'string' ? t('resultsFor', { q }) : t('allListings')} | Accordo`,
    alternates: { canonical: '/annunci' },
    // Free-text and filtered results are not landing pages (SPEC §9.3).
    robots: Object.keys(toQuery(await searchParams)).length
      ? { index: false, follow: true }
      : undefined,
  };
}

export default async function ListingsSearchPage({
  params,
  searchParams,
}: PageProps<'/[locale]/annunci'>) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('Search');
  const raw = await searchParams;
  const { q } = toQuery(raw);
  return (
    <SearchResultsPage
      raw={raw}
      basePath="/annunci"
      heading={typeof q === 'string' ? t('resultsFor', { q }) : t('allListings')}
    />
  );
}
