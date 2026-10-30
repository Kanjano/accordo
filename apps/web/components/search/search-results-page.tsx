import { ApiError } from '@accordo/sdk';
import type {
  AttributeDef,
  BrandOption,
  ComuneOption,
  DepartmentTree,
  SearchQuery,
  SearchResult,
} from '@accordo/shared';
import { Alert } from '@accordo/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { Link } from '@/i18n/navigation';
import { queryString, type RawSearchParams, toQuery } from '@/lib/search';
import { cachedApi, serverApi } from '@/lib/server-api';
import { FilterPanel } from './filter-panel';
import { ResultsGrid } from './results-grid';
import { SearchToolbar } from './search-toolbar';

/** One search per request, shared by generateMetadata and the page (null: invalid filters). */
export const loadSearch = cache(async (qs: string): Promise<SearchResult | null> => {
  try {
    return await (await serverApi()).get<SearchResult>(`/api/v1/search/listings${qs}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) return null;
    throw e;
  }
});

export const loadCatalog = cache(async () => {
  const api = cachedApi();
  const [departments, brands, regions] = await Promise.all([
    api.get<DepartmentTree[]>('/api/v1/catalog/departments'),
    api.get<BrandOption[]>('/api/v1/catalog/brands/all'),
    api.get<Array<{ slug: string; name: string }>>('/api/v1/geo/regioni'),
  ]);
  return { departments, brands, regions };
});

/**
 * SPEC §9.3: only the landing pages themselves (department, category, category + brand, brand)
 * are indexable, with a canonical URL; any other filter, or fewer than 3 results, is noindex.
 */
export function landingMetadata({
  path,
  title,
  description,
  raw,
  result,
}: {
  path: string;
  title: string;
  description: string;
  raw: RawSearchParams;
  result: SearchResult | null;
}): Metadata {
  const { page, ...filters } = toQuery(raw);
  const indexable = !Object.keys(filters).length && !!result && result.total >= 3;
  return {
    title: `${title} | Accordo`,
    description,
    alternates: { canonical: page && page !== '1' ? `${path}?page=${page}` : path },
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

/** User query with the path's own filters forced (same key order everywhere: one cached search). */
export function scopedQuery(raw: RawSearchParams, fixed: SearchQuery): SearchQuery {
  const q = toQuery(raw);
  for (const key of Object.keys(fixed)) delete q[key];
  return { ...q, ...fixed };
}

interface Props {
  raw: RawSearchParams;
  /** Filters given by the path (e.g. the category of a category page). */
  fixed?: SearchQuery;
  basePath: string;
  heading: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export async function SearchResultsPage({
  raw,
  fixed = {},
  basePath,
  heading,
  breadcrumbs,
}: Props) {
  const t = await getTranslations('Search');
  const fullQuery = scopedQuery(raw, fixed);
  const query = toQuery(raw);
  for (const key of Object.keys(fixed)) delete query[key];
  const [result, catalog] = await Promise.all([loadSearch(queryString(fullQuery)), loadCatalog()]);
  const api = cachedApi();
  const categorySlug = fullQuery.category as string | undefined;
  const category = catalog.departments
    .flatMap((d) => d.categories)
    .find((c) => c.slug === categorySlug);
  const [attributes, comune] = await Promise.all([
    category ? api.get<AttributeDef[]>(`/api/v1/catalog/categories/${category.id}/attributes`) : [],
    typeof query.comune === 'string'
      ? api.get<ComuneOption>(`/api/v1/geo/comuni/${query.comune}`).catch(() => null)
      : null,
  ]);
  const labels = {
    departments: Object.fromEntries(catalog.departments.map((d) => [d.slug, d.name])),
    categories: Object.fromEntries(
      catalog.departments.flatMap((d) => d.categories.map((c) => [c.slug, c.name])),
    ),
    brands: Object.fromEntries(catalog.brands.map((b) => [b.slug, b.name])),
    regions: catalog.regions,
  };
  const page = result?.page ?? 1;
  const pageHref = (n: number) =>
    `${basePath}${queryString(n === 1 ? query : { ...query, page: String(n) })}`;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
      {breadcrumbs?.length ? (
        <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-1">
            {breadcrumbs.map((b, i) => (
              <li key={b.label}>
                {b.href ? (
                  <Link href={b.href} className="hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page">{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 ? ' ›' : ''}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold text-balance">{heading}</h1>
        {result ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('count', { count: result.total })}
          </p>
        ) : null}
      </header>
      {result?.degraded ? <Alert>{t('degraded')}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <FilterPanel
          basePath={basePath}
          query={query}
          locked={Object.keys(fixed)}
          facets={result?.facets ?? {}}
          labels={labels}
          attributes={attributes.filter((a) => ['ENUM', 'MULTI_ENUM', 'BOOLEAN'].includes(a.type))}
          comune={comune}
        />
        <div className="grid content-start gap-4">
          <SearchToolbar basePath={basePath} query={query} fullQuery={fullQuery} name={heading} />
          {!result ? (
            <Alert tone="error">{t('invalid')}</Alert>
          ) : result.hits.length ? (
            <ResultsGrid key={queryString(fullQuery)} initial={result} query={fullQuery} />
          ) : (
            <div className="rounded-xl border p-8 text-center">
              <p className="font-medium">{t('empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
            </div>
          )}
          {result && result.totalPages > 1 ? (
            <nav
              aria-label={t('pagination')}
              className="hidden items-center justify-center gap-4 text-sm sm:flex"
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)} rel="prev" className="underline underline-offset-4">
                  {t('previous')}
                </Link>
              ) : null}
              <span>{t('pageOf', { page, total: result.totalPages })}</span>
              {page < result.totalPages ? (
                <Link href={pageHref(page + 1)} rel="next" className="underline underline-offset-4">
                  {t('next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
