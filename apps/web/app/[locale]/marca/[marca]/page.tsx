import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  landingMetadata,
  loadCatalog,
  loadSearch,
  SearchResultsPage,
  scopedQuery,
} from '@/components/search/search-results-page';
import { queryString } from '@/lib/search';

type Props = PageProps<'/[locale]/marca/[marca]'>;

async function scope(params: Props['params']) {
  const { marca } = await params;
  const brand = (await loadCatalog()).brands.find((b) => b.slug === marca);
  if (!brand) notFound();
  return { brand, fixed: { brand: brand.slug }, path: `/marca/${brand.slug}` };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations('Search');
  const { brand, fixed, path } = await scope(params);
  const raw = await searchParams;
  return landingMetadata({
    path,
    title: t('brandTitle', { brand: brand.name }),
    description: t('landingDescription', { what: brand.name }),
    raw,
    result: await loadSearch(queryString(scopedQuery(raw, fixed))),
  });
}

export default async function BrandPage({ params, searchParams }: Props) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Search');
  const { brand, fixed, path } = await scope(params);
  return (
    <SearchResultsPage
      raw={await searchParams}
      fixed={fixed}
      basePath={path}
      heading={t('brandTitle', { brand: brand.name })}
      breadcrumbs={[{ label: t('home'), href: '/' }, { label: brand.name }]}
    />
  );
}
