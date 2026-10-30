import type { Prisma, PrismaClient } from '@accordo/db';
import {
  documentInclude,
  INDEXED_STATUSES,
  type Meilisearch,
  searchListings,
  suggest,
  toListingDocument,
  toSearchHit,
} from '@accordo/search';
import type { SearchParams, SearchResult, SearchSuggestion } from '@accordo/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRISMA, SEARCH } from '../platform/infra.providers.js';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SEARCH) private readonly client: Meilisearch,
  ) {}

  async listings(p: SearchParams): Promise<SearchResult> {
    try {
      return await searchListings(this.client, this.db, p);
    } catch (e) {
      this.logger.warn(`Meilisearch unavailable, PostgreSQL fallback: ${String(e)}`);
      return this.fallback(p);
    }
  }

  async suggest(q: string): Promise<SearchSuggestion[]> {
    if (!q.trim()) return [];
    try {
      return await suggest(this.client, q);
    } catch {
      const [brands, categories] = await Promise.all([
        this.db.brand.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          take: 4,
          select: { name: true, slug: true },
        }),
        this.db.category.findMany({
          where: { name: { contains: q, mode: 'insensitive' }, isActive: true },
          take: 4,
          select: { name: true, slug: true, department: { select: { slug: true, name: true } } },
        }),
      ]);
      return [
        ...brands.map((b) => ({ kind: 'brand' as const, label: b.name, path: `/marca/${b.slug}` })),
        ...categories.map((c) => ({
          kind: 'category' as const,
          label: `${c.name} (${c.department.name})`,
          path: `/categoria/${c.department.slug}/${c.slug}`,
        })),
      ];
    }
  }

  /**
   * Degraded mode (SPEC §9.3): every word must appear in the title (ILIKE, served by the
   * `pg_trgm` GIN index) plus the basic filters; no typo tolerance, facets or distance.
   */
  private async fallback(p: SearchParams): Promise<SearchResult> {
    const words = (p.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
    const where: Prisma.ListingWhereInput = {
      status: { in: [...INDEXED_STATUSES] },
      deletedAt: null,
      AND: words.map((w) => ({ title: { contains: w, mode: 'insensitive' as const } })),
      category: {
        ...(p.category ? { slug: p.category } : {}),
        ...(p.department ? { department: { slug: p.department } } : {}),
      },
      ...(p.brand?.length ? { brand: { slug: { in: p.brand } } } : {}),
      ...(p.condition?.length ? { condition: { in: p.condition } } : {}),
      priceCents: {
        ...(p.priceMin !== undefined ? { gte: p.priceMin * 100 } : {}),
        ...(p.priceMax !== undefined ? { lte: p.priceMax * 100 } : {}),
      },
      comune: {
        ...(p.comune ? { id: p.comune } : {}),
        provincia: {
          ...(p.province ? { sigla: p.province } : {}),
          ...(p.region ? { regione: { slug: p.region } } : {}),
        },
      },
      ...(p.sellerType ? { shopId: p.sellerType === 'BUSINESS' ? { not: null } : null } : {}),
      ...(p.protectedPayment ? { protectedPaymentEnabled: true } : {}),
      ...(p.handDelivery ? { handDeliveryEnabled: true } : {}),
    };
    const orderBy: Prisma.ListingOrderByWithRelationInput =
      p.sort === 'price_asc'
        ? { priceCents: 'asc' }
        : p.sort === 'price_desc'
          ? { priceCents: 'desc' }
          : { bumpedAt: { sort: 'desc', nulls: 'last' } };
    const [total, rows] = await Promise.all([
      this.db.listing.count({ where }),
      this.db.listing.findMany({
        where,
        include: documentInclude,
        orderBy,
        skip: (p.page - 1) * p.hitsPerPage,
        take: p.hitsPerPage,
      }),
    ]);
    return {
      hits: rows.map((r) => toSearchHit(toListingDocument(r))),
      total,
      page: p.page,
      totalPages: Math.ceil(total / p.hitsPerPage),
      hitsPerPage: p.hitsPerPage,
      facets: {},
      degraded: true,
    };
  }
}
