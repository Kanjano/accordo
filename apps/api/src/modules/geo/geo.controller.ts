import type { PrismaClient } from '@accordo/db';
import type { ComuneOption } from '@accordo/shared';
import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { PRISMA } from '../platform/infra.providers.js';

@Controller('geo')
@Public()
export class GeoController {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Autocomplete: prefix match first, then contains; max 10. */
  @Get('comuni')
  async comuni(@Query('q') q = ''): Promise<ComuneOption[]> {
    const term = q.trim().slice(0, 60);
    if (term.length < 2) return [];
    const select = {
      id: true,
      name: true,
      caps: true,
      provincia: { select: { sigla: true } },
    } as const;
    const prefix = await this.db.comune.findMany({
      where: { name: { startsWith: term, mode: 'insensitive' } },
      select,
      orderBy: { name: 'asc' },
      take: 10,
    });
    const more =
      prefix.length < 10
        ? await this.db.comune.findMany({
            where: {
              name: { contains: term, mode: 'insensitive' },
              id: { notIn: prefix.map((c) => c.id) },
            },
            select,
            orderBy: { name: 'asc' },
            take: 10 - prefix.length,
          })
        : [];
    return [...prefix, ...more].map((c) => ({
      id: c.id,
      name: c.name,
      provinciaSigla: c.provincia.sigla,
      caps: c.caps,
    }));
  }

  @Get('comuni/:id')
  async comune(@Param('id') id: string): Promise<ComuneOption> {
    const c = /^\d{6}$/.test(id)
      ? await this.db.comune.findUnique({
          where: { id },
          select: { id: true, name: true, caps: true, provincia: { select: { sigla: true } } },
        })
      : null;
    if (!c) throw new NotFoundException();
    return { id: c.id, name: c.name, provinciaSigla: c.provincia.sigla, caps: c.caps };
  }

  @Get('regioni')
  regioni() {
    return this.db.regione.findMany({ orderBy: { name: 'asc' } });
  }

  @Get('province')
  province(@Query('regione') regione?: string) {
    return this.db.provincia.findMany({
      where: regione ? { regione: { slug: regione } } : {},
      select: { id: true, sigla: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }
}
