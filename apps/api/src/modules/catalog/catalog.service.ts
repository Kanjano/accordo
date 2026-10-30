import type { PrismaClient } from '@accordo/db';
import { suggestCategories } from '@accordo/domain';
import type { AttributeDef, BrandOption, DepartmentTree } from '@accordo/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PRISMA, REDIS } from '../platform/infra.providers.js';

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Department → category tree, cached briefly in Valkey (SPEC §5.8). */
  async departments(): Promise<DepartmentTree[]> {
    const cached = await this.redis.get('catalog:tree');
    if (cached) return JSON.parse(cached) as DepartmentTree[];
    const rows = await this.db.department.findMany({
      orderBy: { position: 'asc' },
      include: {
        categories: {
          where: { isActive: true, parentId: null },
          orderBy: { position: 'asc' },
          select: { id: true, slug: true, name: true, shippable: true, defaultParcelSize: true },
        },
      },
    });
    const tree = rows.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      icon: d.icon,
      categories: d.categories,
    }));
    await this.redis.set('catalog:tree', JSON.stringify(tree), 'EX', 300);
    return tree;
  }

  async attributes(categoryId: string): Promise<AttributeDef[]> {
    const category = await this.db.category.findUnique({
      where: { id: categoryId },
      include: { attributes: { include: { attribute: true }, orderBy: { position: 'asc' } } },
    });
    if (!category) throw new NotFoundException();
    return category.attributes.map(({ attribute: a, required }) => ({
      key: a.key,
      label: a.label,
      type: a.type,
      unit: a.unit,
      options: (a.options as AttributeDef['options']) ?? null,
      required,
    }));
  }

  /** Autocomplete on names and aliases ("fender usa" → Fender). */
  async brands(q: string): Promise<BrandOption[]> {
    const term = fold(q).slice(0, 40);
    if (term.length < 1) return [];
    const all = await this.cachedBrands();
    const matches = all.filter(
      (b) => fold(b.name).startsWith(term) || b.aliases.some((a) => fold(a).startsWith(term)),
    );
    const contains = all.filter((b) => !matches.includes(b) && fold(b.name).includes(term));
    return [...matches, ...contains].slice(0, 10).map(({ id, name, slug }) => ({ id, name, slug }));
  }

  private async cachedBrands() {
    const cached = await this.redis.get('catalog:brands');
    if (cached) return JSON.parse(cached) as Array<BrandOption & { aliases: string[] }>;
    const rows = await this.db.brand.findMany({
      select: { id: true, name: true, slug: true, aliases: true },
      orderBy: { name: 'asc' },
    });
    await this.redis.set('catalog:brands', JSON.stringify(rows), 'EX', 300);
    return rows;
  }

  async suggestCategory(title: string) {
    const tree = await this.departments();
    const flat = tree.flatMap((d) =>
      d.categories.map((c) => ({ ...c, department: { slug: d.slug, name: d.name } })),
    );
    return suggestCategories(title, flat);
  }
}
