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

type Props = PageProps<'/[locale]/categoria/[reparto]/[categoria]/[marca]'>;

async function scope(params: Props['params']) {
  const { reparto, categoria, marca } = await params;
  const catalog = await loadCatalog();
  const department = catalog.departments.find((d) => d.slug === reparto);
  const category = department?.categories.find((c) => c.slug === categoria);
  const brand = catalog.brands.find((b) => b.slug === marca);
  if (!department || !category || !brand) notFound();
  const path = `/categoria/${department.slug}/${category.slug}/${brand.slug}`;
  return {
    department,
    category,
    brand,
    title: `${category.name} ${brand.name}`,
    fixed: { department: department.slug, category: category.slug, brand: brand.slug },
    path,
  };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations('Search');
  const { title, fixed, path } = await scope(params);
  const raw = await searchParams;
  return landingMetadata({
    path,
    title,
    description: t('landingDescription', { what: title }),
    raw,
    result: await loadSearch(queryString(scopedQuery(raw, fixed))),
  });
}

export default async function CategoryBrandPage({ params, searchParams }: Props) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Search');
  const { department, category, brand, title, fixed, path } = await scope(params);
  return (
    <SearchResultsPage
      raw={await searchParams}
      fixed={fixed}
      basePath={path}
      heading={title}
      breadcrumbs={[
        { label: t('home'), href: '/' },
        { label: department.name, href: `/categoria/${department.slug}` },
        { label: category.name, href: `/categoria/${department.slug}/${category.slug}` },
        { label: brand.name },
      ]}
    />
  );
}
