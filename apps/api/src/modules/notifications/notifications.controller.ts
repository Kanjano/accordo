import type { PrismaClient } from '@accordo/db';
import type { NotificationItem, Page } from '@accordo/shared';
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AllowUnverified, CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { PRISMA } from '../platform/infra.providers.js';

const readSchema = z.object({ ids: z.array(z.uuid()).max(100).optional() });

@Controller('me/notifications')
@AllowUnverified()
export class NotificationsController {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthSession,
    @Query('cursor') cursor?: string,
  ): Promise<Page<NotificationItem>> {
    const rows = await this.db.notification.findMany({
      where: { userId: auth.user.id, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: 31,
    });
    const items = rows.slice(0, 30).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data as Record<string, unknown> | null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > 30 ? (items.at(-1)?.id ?? null) : null };
  }

  @Get('unread-count')
  async unread(@CurrentAuth() auth: AuthSession): Promise<{ count: number }> {
    return {
      count: await this.db.notification.count({ where: { userId: auth.user.id, readAt: null } }),
    };
  }

  /** Marks the given notifications (or all) as read. */
  @Post('read')
  @HttpCode(204)
  async read(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: readSchema }) body: z.infer<typeof readSchema>,
  ) {
    await this.db.notification.updateMany({
      where: { userId: auth.user.id, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });
  }
}
