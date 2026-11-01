import type { Prisma, PrismaClient } from '@accordo/db';
import { sameShape } from '@accordo/domain';
import type {
  AdminAuditItem,
  AdminCatalog,
  AdminDashboard,
  AdminWebhookItem,
  attributeSchema,
  brandSchema,
  categorySchema,
  departmentSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { PRISMA, REDIS } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { SettingsService } from '../platform/settings.service.js';

const DAY = 86_400_000;
const PAYMENT_PROVIDERS = new Set(['fake', 'stripe']);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Back office: KPIs, settings and catalog editors, audit log, webhook log (SPEC §3.10). */
@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── Dashboard ─────────────

  async dashboard(now = new Date()): Promise<AdminDashboard> {
    const since30 = new Date(now.getTime() - 30 * DAY);
    const since12m = new Date(now.getTime() - 365 * DAY);
    const db = this.db;
    const [gmv, statuses, paid30, disputes30, shipped, backlog, dsaReports, actions, decided] =
      await Promise.all([
        db.order.aggregate({
          where: { paidAt: { gte: since30 }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
          _sum: { totalCents: true },
          _count: true,
        }),
        db.order.groupBy({ by: ['status'], _count: true }),
        db.order.count({ where: { paidAt: { gte: since30 } } }),
        db.dispute.count({ where: { createdAt: { gte: since30 } } }),
        db.order.findMany({
          where: { shippedAt: { gte: since30 }, paidAt: { not: null } },
          select: { paidAt: true, shippedAt: true },
          take: 5000,
        }),
        Promise.all([
          db.report.count({
            where: { status: { in: ['OPEN', 'IN_REVIEW'] }, targetType: { not: 'FEEDBACK' } },
          }),
          db.listing.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
          db.moderationAction.count({
            where: { appealedAt: { not: null }, appealDecidedAt: null },
          }),
          db.shop.count({ where: { isVerified: false, rejectedAt: null } }),
          db.dispute.count({ where: { status: 'UNDER_REVIEW' } }),
          db.feedback.count({ where: { status: 'HIDDEN' } }),
          db.webhookEvent.count({ where: { processedAt: null, attempts: { gt: 0 } } }),
        ]),
        db.report.count({ where: { createdAt: { gte: since12m } } }),
        db.moderationAction.groupBy({
          by: ['automated'],
          where: { createdAt: { gte: since12m } },
          _count: true,
        }),
        db.report.findMany({
          where: { decidedAt: { gte: since12m } },
          select: { createdAt: true, decidedAt: true },
          take: 5000,
        }),
      ]);
    const [appeals, reversed] = await Promise.all([
      db.moderationAction.count({ where: { appealedAt: { gte: since12m } } }),
      db.moderationAction.count({ where: { reversedAt: { gte: since12m } } }),
    ]);
    const shipHours = shipped.map(
      (o) => ((o.shippedAt as Date).getTime() - (o.paidAt as Date).getTime()) / 3_600_000,
    );
    const decideHours = median(
      decided.map((r) => ((r.decidedAt as Date).getTime() - r.createdAt.getTime()) / 3_600_000),
    );
    const [reports, listings, appealsOpen, shops, disputesOpen, feedback, webhooksFailed] = backlog;
    return {
      gmv30dCents: gmv._sum.totalCents ?? 0,
      orders30d: gmv._count,
      ordersByStatus: Object.fromEntries(statuses.map((s) => [s.status, s._count])),
      disputeRateBps: paid30 ? Math.round((disputes30 / paid30) * 10_000) : 0,
      avgShipHours: shipHours.length
        ? Math.round(shipHours.reduce((a, b) => a + b, 0) / shipHours.length)
        : null,
      backlog: {
        reports,
        listings,
        appeals: appealsOpen,
        shops,
        disputes: disputesOpen,
        feedback,
        webhooksFailed,
      },
      dsa: {
        reports: dsaReports,
        actions: actions.reduce((n, a) => n + a._count, 0),
        automatedActions: actions.find((a) => a.automated)?._count ?? 0,
        appeals,
        reversed,
        medianDecisionHours: decideHours === null ? null : Math.round(decideHours),
      },
    };
  }

  // ───────────── Settings ─────────────

  async listSettings() {
    const rows = await this.db.platformSetting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() }));
  }

  /** Same shape as the current value only (`sameShape`): a typo can't take the platform down. */
  async updateSetting(staffId: string, key: string, value: unknown) {
    const row = await this.db.platformSetting.findUnique({ where: { key } });
    if (!row) throw new NotFoundException();
    if (!sameShape(row.value, value)) throw new BadRequestException({ code: 'SETTING_SHAPE' });
    await this.db.$transaction([
      this.db.platformSetting.update({
        where: { key },
        data: { value: value as Prisma.InputJsonValue, updatedById: staffId },
      }),
      this.db.auditLog.create({
        data: {
          actorId: staffId,
          action: 'settings.update',
          entityType: 'PlatformSetting',
          entityId: key,
          metadata: { before: row.value, after: value as Prisma.InputJsonValue },
        },
      }),
    ]);
    await this.settings.invalidate(key);
    return { key, value, updatedAt: new Date().toISOString() };
  }

  // ───────────── Catalog ─────────────

  async catalog(): Promise<AdminCatalog> {
    const [departments, categories, attributes] = await Promise.all([
      this.db.department.findMany({ orderBy: { position: 'asc' } }),
      this.db.category.findMany({
        orderBy: [{ departmentId: 'asc' }, { position: 'asc' }],
        include: { attributes: { orderBy: { position: 'asc' } } },
      }),
      this.db.attributeDefinition.findMany({ orderBy: { key: 'asc' } }),
    ]);
    return {
      departments,
      categories: categories.map(({ attributes: a, ...c }) => ({
        ...c,
        attributes: a.map((x) => ({ attributeId: x.attributeId, required: x.required })),
      })),
      attributes: attributes.map((a) => ({
        ...a,
        options: a.options as Array<{ value: string; label: string }> | null,
      })),
    };
  }

  async brands(q: string | undefined) {
    return this.db.brand.findMany({
      where: q?.trim() ? { name: { contains: q.trim().slice(0, 60), mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  /** Every catalog write: audit, cache flush and search sync (facets, autocomplete). */
  private async catalogWrite<T>(
    staffId: string,
    entity: string,
    id: string | null,
    write: (tx: Prisma.TransactionClient) => Promise<T & { id: string }>,
  ): Promise<T & { id: string }> {
    try {
      const row = await this.db.$transaction(async (tx) => {
        const r = await write(tx);
        await tx.auditLog.create({
          data: {
            actorId: staffId,
            action: `catalog.${entity}.${id ? 'update' : 'create'}`,
            entityType: entity,
            entityId: r.id,
          },
        });
        await writeOutbox(tx, {
          aggregateType: 'Catalog',
          aggregateId: r.id,
          type: 'catalog.sync',
          payload: {},
        });
        return r;
      });
      await this.redis.del('catalog:tree', 'catalog:brands');
      return row;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException({ code: 'CATALOG_DUPLICATE' });
      if (code === 'P2025' || code === 'P2003') throw new NotFoundException();
      throw e;
    }
  }

  saveDepartment(staffId: string, id: string | null, d: z.infer<typeof departmentSchema>) {
    return this.catalogWrite(staffId, 'Department', id, (tx) =>
      id ? tx.department.update({ where: { id }, data: d }) : tx.department.create({ data: d }),
    );
  }

  saveCategory(staffId: string, id: string | null, c: z.infer<typeof categorySchema>) {
    return this.catalogWrite(staffId, 'Category', id, (tx) =>
      id ? tx.category.update({ where: { id }, data: c }) : tx.category.create({ data: c }),
    );
  }

  saveAttribute(staffId: string, id: string | null, a: z.infer<typeof attributeSchema>) {
    const data = { ...a, options: a.options ?? undefined };
    return this.catalogWrite(staffId, 'AttributeDefinition', id, (tx) =>
      id
        ? tx.attributeDefinition.update({ where: { id }, data })
        : tx.attributeDefinition.create({ data }),
    );
  }

  setCategoryAttributes(
    staffId: string,
    categoryId: string,
    list: Array<{ attributeId: string; required: boolean }>,
  ) {
    return this.catalogWrite(staffId, 'Category', categoryId, async (tx) => {
      await tx.categoryAttribute.deleteMany({ where: { categoryId } });
      await tx.categoryAttribute.createMany({
        data: list.map((a, position) => ({ categoryId, ...a, position })),
      });
      return { id: categoryId };
    });
  }

  saveBrand(staffId: string, id: string | null, b: z.infer<typeof brandSchema>) {
    return this.catalogWrite(staffId, 'Brand', id, (tx) =>
      id ? tx.brand.update({ where: { id }, data: b }) : tx.brand.create({ data: b }),
    );
  }

  // ───────────── Audit and webhooks ─────────────

  async audit(q: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    before?: string;
  }): Promise<AdminAuditItem[]> {
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    const rows = await this.db.auditLog.findMany({
      where: {
        ...(uuid(q.actorId) ? { actorId: q.actorId } : {}),
        ...(q.entityType ? { entityType: q.entityType.slice(0, 60) } : {}),
        ...(q.entityId ? { entityId: q.entityId.slice(0, 100) } : {}),
        ...(uuid(q.before) ? { id: { lt: q.before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async webhooks(status: 'failed' | 'pending' | 'processed'): Promise<AdminWebhookItem[]> {
    const rows = await this.db.webhookEvent.findMany({
      where:
        status === 'processed'
          ? { processedAt: { not: null } }
          : status === 'failed'
            ? { processedAt: null, attempts: { gt: 0 } }
            : { processedAt: null, attempts: 0 },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
    return rows.map((w) => ({
      provider: w.provider,
      eventId: w.eventId,
      type: w.type,
      receivedAt: w.receivedAt.toISOString(),
      processedAt: w.processedAt?.toISOString() ?? null,
      attempts: w.attempts,
      lastError: w.lastError,
    }));
  }

  /** Re-queues an unprocessed event; handlers are idempotent (processed once, SPEC §6.10). */
  async replay(staffId: string, provider: string, eventId: string) {
    const row = await this.db.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });
    if (!row) throw new NotFoundException();
    if (row.processedAt) throw new ConflictException({ code: 'WEBHOOK_ALREADY_PROCESSED' });
    const type = PAYMENT_PROVIDERS.has(provider) ? 'webhook.received' : 'shipping.updates';
    await this.db.$transaction(async (tx) => {
      await writeOutbox(tx, {
        aggregateType: 'WebhookEvent',
        aggregateId: eventId,
        type,
        payload: { provider, eventId },
      });
      await tx.auditLog.create({
        data: {
          actorId: staffId,
          action: 'webhook.replay',
          entityType: 'WebhookEvent',
          entityId: `${provider}/${eventId}`,
        },
      });
    });
  }
}
