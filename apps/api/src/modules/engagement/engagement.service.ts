import type { PrismaClient } from '@accordo/db';
import { documentInclude, toListingDocument, toSearchHit } from '@accordo/search';
import type { FollowedUser, Page, SearchHit } from '@accordo/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';

const PUBLIC = ['ACTIVE', 'RESERVED', 'SOLD'] as const;
const RECENT_MAX = 50;

const card = (row: Parameters<typeof toListingDocument>[0]): SearchHit =>
  toSearchHit(toListingDocument(row));

/** Favorites, recently viewed and the following feed (SPEC §3.4), scoped to the current user. */
@Injectable()
export class EngagementService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  // ───────────── Favorites ─────────────

  async favoriteIds(userId: string): Promise<string[]> {
    const rows = await this.db.favorite.findMany({
      where: { userId },
      select: { listingId: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return rows.map((r) => r.listingId);
  }

  async favorites(userId: string): Promise<SearchHit[]> {
    const rows = await this.db.favorite.findMany({
      where: { userId, listing: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { listing: { include: documentInclude } },
    });
    return rows.map((r) => card(r.listing));
  }

  /** Idempotent; `favoritesCount` moves only when the row really changes. */
  async setFavorite(userId: string, listingId: string, on: boolean): Promise<void> {
    const listing = await this.db.listing.findFirst({
      where: { id: listingId, deletedAt: null, status: { in: [...PUBLIC] } },
      select: { id: true },
    });
    if (!listing) throw new NotFoundException();
    await this.db.$transaction(async (tx) => {
      const { count } = on
        ? await tx.favorite.createMany({ data: { userId, listingId }, skipDuplicates: true })
        : await tx.favorite.deleteMany({ where: { userId, listingId } });
      if (count)
        await tx.listing.update({
          where: { id: listingId },
          data: { favoritesCount: { increment: on ? 1 : -1 } },
        });
    });
  }

  // ───────────── Recently viewed ─────────────

  /** `listingIds` newest first; also used to merge the anonymous localStorage history at login. */
  async recordViews(userId: string, listingIds: string[]): Promise<void> {
    const existing = await this.db.listing.findMany({
      where: { id: { in: listingIds }, deletedAt: null, status: { in: [...PUBLIC] } },
      select: { id: true },
    });
    const valid = new Set(existing.map((l) => l.id));
    const now = Date.now();
    await this.db.$transaction(async (tx) => {
      for (const [i, listingId] of listingIds.entries()) {
        if (!valid.has(listingId)) continue;
        const viewedAt = new Date(now - i);
        await tx.recentlyViewed.upsert({
          where: { userId_listingId: { userId, listingId } },
          create: { userId, listingId, viewedAt },
          update: { viewedAt },
        });
      }
      const stale = await tx.recentlyViewed.findMany({
        where: { userId },
        orderBy: { viewedAt: 'desc' },
        skip: RECENT_MAX,
        select: { listingId: true },
      });
      if (stale.length)
        await tx.recentlyViewed.deleteMany({
          where: { userId, listingId: { in: stale.map((s) => s.listingId) } },
        });
    });
  }

  async recentlyViewed(userId: string): Promise<SearchHit[]> {
    const rows = await this.db.recentlyViewed.findMany({
      where: { userId, listing: { deletedAt: null, status: { in: [...PUBLIC] } } },
      orderBy: { viewedAt: 'desc' },
      take: RECENT_MAX,
      include: { listing: { include: documentInclude } },
    });
    return rows.map((r) => card(r.listing));
  }

  // ───────────── Following ─────────────

  async following(userId: string): Promise<FollowedUser[]> {
    const rows = await this.db.follow.findMany({
      where: { followerId: userId, followed: { status: { not: 'DELETED' } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { followed: { select: { id: true, username: true, name: true } } },
    });
    return rows.map((r) => ({ ...r.followed, followedAt: r.createdAt.toISOString() }));
  }

  /** New listings of followed users, newest first, cursor = last listing id. */
  async followingFeed(userId: string, cursor?: string, limit = 24): Promise<Page<SearchHit>> {
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.db.listing.findMany({
      where: {
        status: { in: ['ACTIVE', 'RESERVED'] },
        deletedAt: null,
        seller: { followers: { some: { followerId: userId } } },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      include: documentInclude,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take);
    return {
      items: items.map(card),
      nextCursor: rows.length > take ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
