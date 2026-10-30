import { z } from 'zod';
import { ITEM_CONDITIONS, type ItemCondition, type ListingStatus } from './listings.js';
import type { ListingCardItem } from './users.js';

export const SEARCH_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'distance'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const MAX_HITS_PER_PAGE = 48;

const slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
/** Repeated keys (`brand=a&brand=b`) or a comma-separated value. */
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(item).max(20),
  );
const flag = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.enum(['true', '1']));
const euros = z.coerce.number().int().min(0).max(10_000_000);
const year = z.coerce.number().int().min(1900).max(2100);
const attrKey = /^attr\.([a-zA-Z0-9_]{1,40})$/;

/**
 * Search parameters (SPEC §11.2) as they appear in the URL and in saved searches.
 * Prices are whole euros (`priceMin=500`), attributes are `attr.<key>=<value>`.
 */
export const searchParamsSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const attr: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = attrKey.exec(k)?.[1];
      const value = Array.isArray(v) ? v[0] : v;
      if (key && typeof value === 'string' && value.length <= 60) attr[key] = value;
    }
    return { ...raw, attr };
  },
  z.object({
    q: z.string().trim().max(120).optional(),
    department: slug.optional(),
    category: slug.optional(),
    brand: list(slug).optional(),
    priceMin: euros.optional(),
    priceMax: euros.optional(),
    condition: list(z.enum(ITEM_CONDITIONS)).optional(),
    region: slug.optional(),
    province: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    comune: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    radiusKm: z.coerce.number().int().min(1).max(500).optional(),
    sellerType: z.enum(['PRIVATE', 'BUSINESS']).optional(),
    protectedPayment: flag.optional(),
    shipping: flag.optional(),
    handDelivery: flag.optional(),
    topSeller: flag.optional(),
    yearMin: year.optional(),
    yearMax: year.optional(),
    attr: z.record(z.string(), z.string()),
    sort: z.enum(SEARCH_SORTS).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    hitsPerPage: z.coerce.number().int().min(1).max(MAX_HITS_PER_PAGE).default(24),
  }),
);
export type SearchParams = z.infer<typeof searchParamsSchema>;
/** URL-shaped query (what saved searches store). */
export type SearchQuery = Record<string, string | string[]>;

export interface SearchHit extends ListingCardItem {
  condition: ItemCondition;
  status: ListingStatus;
  brand: string | null;
  sellerType: 'PRIVATE' | 'BUSINESS';
  sellerPositivePctBps: number | null;
  isTopSeller: boolean;
  protectedPayment: boolean;
  shippingAvailable: boolean;
  handDelivery: boolean;
  /** Only when sorting by distance. */
  distanceKm?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  totalPages: number;
  hitsPerPage: number;
  /** facet → value → count (empty in degraded mode). */
  facets: Record<string, Record<string, number>>;
  /** Meilisearch unreachable: PostgreSQL fallback with basic filters only (SPEC §9.3). */
  degraded: boolean;
}

export interface SearchSuggestion {
  kind: 'brand' | 'category' | 'listing';
  label: string;
  /** Web path to open. */
  path: string;
}

export const ALERT_FREQUENCIES = ['NONE', 'INSTANT', 'DAILY'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];

const searchQuerySchema = z
  .record(z.string().max(40), z.union([z.string().max(200), z.array(z.string().max(80)).max(20)]))
  .refine((q) => Object.keys(q).length <= 30)
  .refine((q) => searchParamsSchema.safeParse(q).success, 'INVALID_QUERY');

export const savedSearchCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: searchQuerySchema,
  alertFrequency: z.enum(ALERT_FREQUENCIES).default('DAILY'),
});
export const savedSearchUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  alertFrequency: z.enum(ALERT_FREQUENCIES).optional(),
});
export type SavedSearchCreate = z.infer<typeof savedSearchCreateSchema>;

export interface SavedSearchItem {
  id: string;
  name: string;
  query: SearchQuery;
  alertFrequency: AlertFrequency;
  lastNotifiedAt: string | null;
  createdAt: string;
}

export const recentlyViewedSchema = z.object({
  listingIds: z.array(z.uuid()).min(1).max(50),
});

export interface FollowedUser {
  id: string;
  username: string | null;
  name: string;
  followedAt: string;
}

export interface SitemapEntry {
  path: string;
  lastModified: string;
}
