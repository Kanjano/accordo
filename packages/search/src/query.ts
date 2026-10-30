import type { SearchHit, SearchParams } from '@accordo/shared';
import type { ListingDocument } from './document.js';

export interface SearchContext {
  /** Centroid of `params.comune` (SPEC §9.3: distance search). */
  geo?: { lat: number; lng: number };
  /** Attribute keys of the selected category worth faceting on. */
  facetAttributes?: string[];
}

export interface ListingSearchRequest {
  q: string;
  filter: string[];
  sort: string[];
  facets: string[];
  page: number;
  hitsPerPage: number;
}

export const BASE_FACETS = [
  'departmentSlug',
  'categorySlug',
  'brandSlug',
  'condition',
  'sellerType',
  'regioneSlug',
  'protectedPayment',
  'shippingAvailable',
  'handDelivery',
];

const quote = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`;
const anyOf = (field: string, values: string[]) => `${field} IN [${values.map(quote).join(', ')}]`;

/** URL parameters → Meilisearch filters, sort and facets. `extra` filters are ANDed (e.g. alerts). */
export function buildListingSearch(
  p: SearchParams,
  ctx: SearchContext = {},
  extra: string[] = [],
): ListingSearchRequest {
  const f = [...extra];
  if (p.department) f.push(`departmentSlug = ${quote(p.department)}`);
  if (p.category) f.push(`categorySlug = ${quote(p.category)}`);
  if (p.brand?.length) f.push(anyOf('brandSlug', p.brand));
  if (p.condition?.length) f.push(anyOf('condition', p.condition));
  if (p.priceMin !== undefined) f.push(`priceCents >= ${p.priceMin * 100}`);
  if (p.priceMax !== undefined) f.push(`priceCents <= ${p.priceMax * 100}`);
  if (p.region) f.push(`regioneSlug = ${quote(p.region)}`);
  if (p.province) f.push(`provinciaSigla = ${quote(p.province)}`);
  if (p.comune && ctx.geo && p.radiusKm)
    f.push(`_geoRadius(${ctx.geo.lat}, ${ctx.geo.lng}, ${p.radiusKm * 1000})`);
  else if (p.comune) f.push(`comuneId = ${quote(p.comune)}`);
  if (p.sellerType) f.push(`sellerType = ${quote(p.sellerType)}`);
  if (p.protectedPayment) f.push('protectedPayment = true');
  if (p.shipping) f.push('shippingAvailable = true');
  if (p.handDelivery) f.push('handDelivery = true');
  if (p.topSeller) f.push('isTopSeller = true');
  if (p.yearMin !== undefined) f.push(`year >= ${p.yearMin}`);
  if (p.yearMax !== undefined) f.push(`year <= ${p.yearMax}`);
  for (const [key, value] of Object.entries(p.attr)) f.push(`attr.${key} = ${quote(value)}`);

  const sortKey = p.sort ?? (p.q ? 'relevance' : 'newest');
  const sort =
    sortKey === 'distance' && ctx.geo
      ? [`_geoPoint(${ctx.geo.lat}, ${ctx.geo.lng}):asc`]
      : sortKey === 'price_asc'
        ? ['priceCents:asc']
        : sortKey === 'price_desc'
          ? ['priceCents:desc']
          : sortKey === 'relevance' && p.q
            ? []
            : ['bumpedAt:desc'];

  return {
    q: p.q ?? '',
    filter: f,
    sort,
    facets: [...BASE_FACETS, ...(ctx.facetAttributes ?? []).map((k) => `attr.${k}`)],
    page: p.page,
    hitsPerPage: p.hitsPerPage,
  };
}

export function toSearchHit(d: ListingDocument & { _geoDistance?: number }): SearchHit {
  return {
    id: d.id,
    shortId: d.shortId,
    slug: d.slug,
    title: d.title,
    priceCents: d.priceCents,
    currency: 'EUR',
    condition: d.condition as SearchHit['condition'],
    location: { comune: d.comuneName, provinciaSigla: d.provinciaSigla },
    publishedAt: d.publishedAt ? new Date(d.publishedAt * 1000).toISOString() : null,
    imageKey: d.imageKey,
    status: d.status,
    brand: d.brand,
    sellerType: d.sellerType,
    sellerPositivePctBps: d.sellerPositivePctBps,
    isTopSeller: d.isTopSeller,
    protectedPayment: d.protectedPayment,
    shippingAvailable: d.shippingAvailable,
    handDelivery: d.handDelivery,
    ...(d._geoDistance !== undefined ? { distanceKm: Math.round(d._geoDistance / 100) / 10 } : {}),
  };
}
