import type { PrismaClient } from '@accordo/db';
import type { SitemapEntry } from '@accordo/shared';
import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { PRISMA } from '../platform/infra.providers.js';

export const SITEMAP_PAGE_SIZE = 10_000;
/** Landing pages with fewer results are `noindex` (SPEC §9.3), so they stay out of the sitemap too. */
const MIN_RESULTS = 3;
const LIVE = {
  status: { in: ['ACTIVE', 'RESERVED'] as Array<'ACTIVE' | 'RESERVED'> },
  deletedAt: null,
};

/** Data for the web sitemaps (SPEC §12.3); the web renders the XML. */
@Controller('seo/sitemap')
@Public()
export class SeoController {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  @Get()
  async index() {
    const listings = await this.db.listing.count({ where: LIVE });
    return { listingPages: Math.max(1, Math.ceil(listings / SITEMAP_PAGE_SIZE)) };
  }

  @Get('listings')
  async listings(@Query('page') page = '1'): Promise<SitemapEntry[]> {
    const n = Number.parseInt(page, 10);
    if (!(n >= 1 && n <= 1000)) throw new BadRequestException({ code: 'INVALID_PAGE' });
    const rows = await this.db.listing.findMany({
      where: LIVE,
      orderBy: { id: 'asc' },
      skip: (n - 1) * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
      select: { slug: true, shortId: true, updatedAt: true },
    });
    return rows.map((l) => ({
      path: `/annuncio/${l.slug}-${l.shortId}`,
      lastModified: l.updatedAt.toISOString(),
    }));
  }

  @Get(':kind')
  async landing(@Param('kind') kind: string): Promise<SitemapEntry[]> {
    const [categories, brands, groups] = await Promise.all([
      this.db.category.findMany({
        select: { id: true, slug: true, department: { select: { slug: true } } },
      }),
      this.db.brand.findMany({ select: { id: true, slug: true } }),
      this.db.listing.groupBy({
        by: ['categoryId', 'brandId'],
        where: LIVE,
        _count: true,
        _max: { updatedAt: true },
      }),
    ]);
    const cat = new Map(categories.map((c) => [c.id, c]));
    const brand = new Map(brands.map((b) => [b.id, b.slug]));
    const acc = new Map<string, { count: number; last: Date }>();
    const add = (path: string, count: number, last: Date | null) => {
      const cur = acc.get(path) ?? { count: 0, last: new Date(0) };
      acc.set(path, {
        count: cur.count + count,
        last: last && last > cur.last ? last : cur.last,
      });
    };
    for (const g of groups) {
      const c = cat.get(g.categoryId);
      if (!c) continue;
      const b = g.brandId ? brand.get(g.brandId) : undefined;
      if (kind === 'categories') {
        add(`/categoria/${c.department.slug}`, g._count, g._max.updatedAt);
        add(`/categoria/${c.department.slug}/${c.slug}`, g._count, g._max.updatedAt);
        if (b) add(`/categoria/${c.department.slug}/${c.slug}/${b}`, g._count, g._max.updatedAt);
      } else if (kind === 'brands' && b) {
        add(`/marca/${b}`, g._count, g._max.updatedAt);
      }
    }
    if (kind !== 'categories' && kind !== 'brands')
      throw new BadRequestException({ code: 'INVALID_SITEMAP' });
    return [...acc]
      .filter(([, v]) => v.count >= MIN_RESULTS)
      .map(([path, v]) => ({ path, lastModified: v.last.toISOString() }));
  }
}
