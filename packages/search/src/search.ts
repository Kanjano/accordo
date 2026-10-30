import type { PrismaClient } from '@accordo/db';
import type { SearchParams, SearchResult, SearchSuggestion } from '@accordo/shared';
import type { Meilisearch } from 'meilisearch';
import type { ListingDocument } from './document.js';
import { buildListingSearch, type SearchContext, toSearchHit } from './query.js';
import { INDEX } from './settings.js';

/** Looks up what the URL only references: the comune centroid and the category's facetable attributes. */
export async function resolveSearchContext(
  db: PrismaClient,
  p: SearchParams,
): Promise<SearchContext> {
  const [comune, category] = await Promise.all([
    p.comune
      ? db.comune.findUnique({ where: { id: p.comune }, select: { lat: true, lng: true } })
      : null,
    p.category
      ? db.category.findFirst({
          where: { slug: p.category },
          select: {
            attributes: {
              select: { attribute: { select: { key: true, type: true } } },
              orderBy: { position: 'asc' },
            },
          },
        })
      : null,
  ]);
  return {
    geo:
      comune?.lat != null && comune.lng != null ? { lat: comune.lat, lng: comune.lng } : undefined,
    facetAttributes: category?.attributes
      .filter(({ attribute: a }) => ['ENUM', 'MULTI_ENUM', 'BOOLEAN'].includes(a.type))
      .map(({ attribute: a }) => a.key),
  };
}

export async function searchListings(
  client: Meilisearch,
  db: PrismaClient,
  p: SearchParams,
  /** Extra filters (ANDed) and a sort override, for internal callers such as alerts. */
  opts: { filter?: string[]; sort?: string[] } = {},
): Promise<SearchResult> {
  const req = buildListingSearch(p, await resolveSearchContext(db, p), opts.filter);
  const res = await client.index<ListingDocument>(INDEX.listings).search(req.q, {
    filter: req.filter,
    sort: opts.sort ?? req.sort,
    facets: req.facets,
    page: req.page,
    hitsPerPage: req.hitsPerPage,
  });
  return {
    hits: res.hits.map(toSearchHit),
    total: res.totalHits ?? 0,
    page: res.page ?? p.page,
    totalPages: res.totalPages ?? 0,
    hitsPerPage: req.hitsPerPage,
    facets: res.facetDistribution ?? {},
    degraded: false,
  };
}

/** Brands, categories and listing titles (SPEC §9.3: at most 8). */
export async function suggest(client: Meilisearch, q: string): Promise<SearchSuggestion[]> {
  const { results } = await client.multiSearch({
    queries: [
      { indexUid: INDEX.brands, q, limit: 3, attributesToRetrieve: ['name', 'slug'] },
      {
        indexUid: INDEX.categories,
        q,
        limit: 3,
        attributesToRetrieve: ['name', 'slug', 'departmentSlug', 'departmentName'],
      },
      { indexUid: INDEX.listings, q, limit: 5, attributesToRetrieve: ['title'] },
    ],
  });
  const [brands, categories, listings] = results.map((r) => r.hits as Record<string, string>[]);
  const titles = [...new Set((listings ?? []).map((h) => h.title as string))];
  return [
    ...(brands ?? []).map((b) => ({
      kind: 'brand' as const,
      label: b.name as string,
      path: `/marca/${b.slug}`,
    })),
    ...(categories ?? []).map((c) => ({
      kind: 'category' as const,
      label: `${c.name} (${c.departmentName})`,
      path: `/categoria/${c.departmentSlug}/${c.slug}`,
    })),
    ...titles.map((title) => ({
      kind: 'listing' as const,
      label: title,
      path: `/annunci?q=${encodeURIComponent(title)}`,
    })),
  ].slice(0, 8);
}
