import type { Prisma, PrismaClient } from '@accordo/db';
import type {
  SavedSearchCreate,
  SavedSearchItem,
  SearchQuery,
  savedSearchUpdateSchema,
} from '@accordo/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { PRISMA } from '../platform/infra.providers.js';

const MAX_PER_USER = 50;

const toItem = (s: {
  id: string;
  name: string;
  query: Prisma.JsonValue;
  alertFrequency: SavedSearchItem['alertFrequency'];
  lastNotifiedAt: Date | null;
  createdAt: Date;
}): SavedSearchItem => ({
  id: s.id,
  name: s.name,
  query: s.query as SearchQuery,
  alertFrequency: s.alertFrequency,
  lastNotifiedAt: s.lastNotifiedAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
});

/** Saved searches, always scoped to their owner (uniform 404). */
@Injectable()
export class SavedSearchesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list(userId: string): Promise<SavedSearchItem[]> {
    const rows = await this.db.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toItem);
  }

  async create(userId: string, input: SavedSearchCreate): Promise<SavedSearchItem> {
    if ((await this.db.savedSearch.count({ where: { userId } })) >= MAX_PER_USER)
      throw new ConflictException({ code: 'TOO_MANY_SAVED_SEARCHES' });
    const { page: _page, ...query } = input.query;
    return toItem(
      await this.db.savedSearch.create({
        data: { userId, name: input.name, query, alertFrequency: input.alertFrequency },
      }),
    );
  }

  async update(
    userId: string,
    id: string,
    input: z.infer<typeof savedSearchUpdateSchema>,
  ): Promise<SavedSearchItem> {
    const { count } = await this.db.savedSearch.updateMany({ where: { id, userId }, data: input });
    if (!count) throw new NotFoundException();
    return toItem(await this.db.savedSearch.findUniqueOrThrow({ where: { id } }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.db.savedSearch.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException();
  }
}
