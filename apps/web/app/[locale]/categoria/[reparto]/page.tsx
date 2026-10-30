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

type Props = PageProps<'/[locale]/categoria/[reparto]'>;

async function scope(params: Props['params']) {
  const { reparto } = await params;
  const department = (await loadCatalog()).departments.find((d) => d.slug === reparto);
  if (!department) notFound();
  return {
    department,
    fixed: { department: department.slug },
    path: `/categoria/${department.slug}`,
  };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations('Search');
  const { department, fixed, path } = await scope(params);
  const raw = await searchParams;
  return landingMetadata({
    path,
    title: department.name,
    description: t('landingDescription', { what: department.name.toLowerCase() }),
    raw,
    result: await loadSearch(queryString(scopedQuery(raw, fixed))),
  });
}

export default async function DepartmentPage({ params, searchParams }: Props) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Search');
  const { department, fixed, path } = await scope(params);
  return (
    <SearchResultsPage
      raw={await searchParams}
      fixed={fixed}
      basePath={path}
      heading={department.name}
      breadcrumbs={[{ label: t('home'), href: '/' }, { label: department.name }]}
    />
  );
}
