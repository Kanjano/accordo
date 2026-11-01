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
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5">
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

      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <FilterPanel
          basePath={basePath}
          query={query}
          locked={Object.keys(fixed)}
          facets={result?.facets ?? {}}
          labels={labels}
          attributes={attributes.filter((a) => ['ENUM', 'MULTI_ENUM', 'BOOLEAN'].includes(a.type))}
          comune={comune}
        />
        <div className="grid min-w-0 content-start gap-3">
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
              className="hidden items-center justify-center gap-2 pt-2 text-sm sm:flex"
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)} rel="prev" className="px-2 py-1 hover:underline">
                  ‹ {t('previous')}
                </Link>
              ) : null}
              <ol className="flex items-center gap-1">
                {pageWindow(page, result.totalPages).map((n, i) =>
                  n === null ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity
                    <li key={`gap-${i}`} aria-hidden>
                      …
                    </li>
                  ) : (
                    <li key={n}>
                      <Link
                        href={pageHref(n)}
                        aria-label={t('page', { page: n })}
                        aria-current={n === page ? 'page' : undefined}
                        className={
                          n === page
                            ? 'grid min-w-9 place-items-center rounded-md bg-primary px-2 py-1.5 font-semibold text-primary-foreground'
                            : 'grid min-w-9 place-items-center rounded-md border px-2 py-1.5 hover:bg-accent'
                        }
                      >
                        {n}
                      </Link>
                    </li>
                  ),
                )}
              </ol>
              {page < result.totalPages ? (
                <Link href={pageHref(page + 1)} rel="next" className="px-2 py-1 hover:underline">
                  {t('next')} ›
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 1 … p-2 p-1 p p+1 p+2 … last (null = gap). */
function pageWindow(page: number, total: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - page) <= 2) out.push(n);
    else if (out.at(-1) !== null) out.push(null);
  }
  return out;
}
