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

type Props = PageProps<'/[locale]/categoria/[reparto]/[categoria]'>;

async function scope(params: Props['params']) {
  const { reparto, categoria } = await params;
  const department = (await loadCatalog()).departments.find((d) => d.slug === reparto);
  const category = department?.categories.find((c) => c.slug === categoria);
  if (!department || !category) notFound();
  return {
    department,
    category,
    fixed: { department: department.slug, category: category.slug },
    path: `/categoria/${department.slug}/${category.slug}`,
  };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations('Search');
  const { category, fixed, path } = await scope(params);
  const raw = await searchParams;
  return landingMetadata({
    path,
    title: category.name,
    description: t('landingDescription', { what: category.name.toLowerCase() }),
    raw,
    result: await loadSearch(queryString(scopedQuery(raw, fixed))),
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Search');
  const { department, category, fixed, path } = await scope(params);
  return (
    <SearchResultsPage
      raw={await searchParams}
      fixed={fixed}
      basePath={path}
      heading={category.name}
      breadcrumbs={[
        { label: t('home'), href: '/' },
        { label: department.name, href: `/categoria/${department.slug}` },
        { label: category.name },
      ]}
    />
  );
}
