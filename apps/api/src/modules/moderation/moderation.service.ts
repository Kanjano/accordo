import type { ModerationActionType, Prisma, PrismaClient, ReportTargetType } from '@accordo/db';
import type {
  AdminAppealItem,
  AdminListingItem,
  AdminReportItem,
  AdminUserDetail,
  AdminUserItem,
  ModerationActionItem,
  MyReportItem,
  ReportCreate,
  ReportDecisionInput,
  Sanction,
} from '@accordo/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SettingsService } from '../platform/settings.service.js';

const DAY = 86_400_000;
const APPEAL_WINDOW_DAYS = 183;
const PUBLIC_LISTING = ['ACTIVE', 'RESERVED', 'SOLD'] as const;

export interface ActionInput {
  actionType: ModerationActionType;
  targetType: ReportTargetType;
  targetId: string;
  targetUserId: string | null;
  reasonCode: string;
  statement: string;
  legalGround?: string;
  reportId?: string;
  days?: number;
}

interface TargetInfo {
  label: string;
  path: string | null;
  userId: string | null;
}

const SANCTION_ACTION: Record<Sanction, ModerationActionType> = {
  WARN: 'USER_WARNED',
  LIMIT: 'USER_LIMITED',
  SUSPEND: 'USER_SUSPENDED',
  BAN: 'USER_BANNED',
};

type ActionRow = Prisma.ModerationActionGetPayload<object>;

/** SPEC §3.10, §14.2: notice & action, statements of reasons, appeals and sanctions. */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── Targets ─────────────

  async describe(type: ReportTargetType, id: string): Promise<TargetInfo | null> {
    switch (type) {
      case 'LISTING': {
        const l = await this.db.listing.findUnique({
          where: { id },
          select: { title: true, slug: true, shortId: true, sellerId: true },
        });
        return (
          l && { label: l.title, path: `/annuncio/${l.slug}-${l.shortId}`, userId: l.sellerId }
        );
      }
      case 'USER': {
        const u = await this.db.user.findUnique({ where: { id }, select: { username: true } });
        return (
          u && {
            label: u.username ? `@${u.username}` : 'Utente',
            path: u.username ? `/utente/${u.username}` : null,
            userId: id,
          }
        );
      }
      case 'MESSAGE': {
        const m = await this.db.message.findUnique({
          where: { id },
          select: { body: true, senderId: true },
        });
        return m && { label: (m.body ?? '').slice(0, 80), path: null, userId: m.senderId };
      }
      case 'SHOP': {
        const s = await this.db.shop.findUnique({
          where: { id },
          select: { name: true, slug: true, ownerId: true },
        });
        return s && { label: s.name, path: `/negozio/${s.slug}`, userId: s.ownerId };
      }
      case 'FEEDBACK': {
        const f = await this.db.feedback.findUnique({
          where: { id },
          select: { comment: true, authorId: true },
        });
        return (
          f && { label: (f.comment ?? 'Feedback').slice(0, 80), path: null, userId: f.authorId }
        );
      }
    }
  }

  // ───────────── Notices (public) ─────────────

  private async verifyCaptcha(token: string | undefined, ip: string | undefined) {
    if (!this.env.TURNSTILE_SECRET_KEY) return;
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: this.env.TURNSTILE_SECRET_KEY,
        response: token ?? '',
        ...(ip ? { remoteip: ip } : {}),
      }),
    }).catch(() => null);
    const ok = res?.ok && ((await res.json()) as { success?: boolean }).success;
    if (!ok) throw new BadRequestException({ code: 'CAPTCHA_FAILED' });
  }

  /** Anyone may report illegal content (DSA art. 16); anonymous reporters leave name and email. */
  async report(
    userId: string | null,
    input: ReportCreate,
    meta: { ip?: string; captcha?: string },
  ): Promise<{ id: string }> {
    if (!userId && (!input.reporterName || !input.reporterEmail))
      throw new BadRequestException({ code: 'REPORTER_REQUIRED' });
    await this.verifyCaptcha(meta.captcha, meta.ip);
    await this.rateLimit.consume(`report:${userId ?? meta.ip ?? 'unknown'}`, 10, 24 * 3600);
    await this.assertReportable(userId, input.targetType, input.targetId);
    const reporter = userId
      ? await this.db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { name: true, email: true },
        })
      : null;
    const report = await this.db.$transaction(async (tx) => {
      const r = await tx.report.create({
        data: {
          reporterId: userId,
          reporterName: reporter?.name ?? input.reporterName,
          reporterEmail: reporter?.email ?? input.reporterEmail,
          targetType: input.targetType,
          targetId: input.targetId,
          reasonCode: input.reasonCode,
          details: input.details,
          isIllegalContent: input.isIllegalContent,
          goodFaithConfirmed: true,
        },
      });
      await writeOutbox(tx, {
        aggregateType: 'Report',
        aggregateId: r.id,
        type: 'report.created',
        payload: { reportId: r.id },
      });
      return r;
    });
    return { id: report.id };
  }

  /** Only content the reporter can see: public listings, profiles, shops, own conversations. */
  private async assertReportable(userId: string | null, type: ReportTargetType, id: string) {
    const found =
      type === 'LISTING'
        ? await this.db.listing.count({
            where: { id, deletedAt: null, status: { in: [...PUBLIC_LISTING] } },
          })
        : type === 'USER'
          ? await this.db.user.count({ where: { id, status: { not: 'DELETED' } } })
          : type === 'SHOP'
            ? await this.db.shop.count({ where: { id } })
            : type === 'MESSAGE' && userId
              ? await this.db.message.count({
                  where: {
                    id,
                    senderId: { not: userId },
                    conversation: { OR: [{ buyerId: userId }, { sellerId: userId }] },
                  },
                })
              : 0;
    if (!found) throw new NotFoundException();
  }

  async myReports(userId: string): Promise<MyReportItem[]> {
    const rows = await this.db.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((r) => this.reportItem(r)));
  }

  private async reportItem(r: Prisma.ReportGetPayload<object>): Promise<MyReportItem> {
    const target = await this.describe(r.targetType, r.targetId);
    return {
      id: r.id,
      targetType: r.targetType,
      targetLabel: target?.label ?? '—',
      reasonCode: r.reasonCode,
      status: r.status,
      decision: r.decision,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }

  // ───────────── Staff: reports ─────────────

  /** Feedback reports have their own queue (SPEC §8.8). */
  async adminReports(status: 'OPEN' | 'CLOSED' = 'OPEN'): Promise<AdminReportItem[]> {
    const rows = await this.db.report.findMany({
      where: {
        targetType: { not: 'FEEDBACK' },
        status:
          status === 'OPEN' ? { in: ['OPEN', 'IN_REVIEW'] } : { in: ['ACTION_TAKEN', 'DISMISSED'] },
      },
      // Illegal-content notices first (DSA: timely, diligent processing).
      orderBy: [{ isIllegalContent: 'desc' }, { createdAt: status === 'OPEN' ? 'asc' : 'desc' }],
      take: 100,
    });
    return Promise.all(
      rows.map(async (r) => {
        const target = await this.describe(r.targetType, r.targetId);
        return {
          ...(await this.reportItem(r)),
          targetId: r.targetId,
          details: r.details,
          isIllegalContent: r.isIllegalContent,
          reporter: { userId: r.reporterId, name: r.reporterName, email: r.reporterEmail },
          targetPath: target?.path ?? null,
          targetUserId: target?.userId ?? null,
          sameTarget: await this.db.report.count({
            where: { targetType: r.targetType, targetId: r.targetId, id: { not: r.id } },
          }),
        };
      }),
    );
  }

  async decide(staffId: string, reportId: string, d: ReportDecisionInput): Promise<void> {
    const report = await this.db.report.findUnique({ where: { id: reportId } });
    if (!report || report.targetType === 'FEEDBACK') throw new NotFoundException();
    if (report.status === 'ACTION_TAKEN' || report.status === 'DISMISSED')
      throw new ConflictException({ code: 'REPORT_ALREADY_DECIDED' });
    const target = await this.describe(report.targetType, report.targetId);
    const open = {
      targetType: report.targetType,
      targetId: report.targetId,
      status: { in: ['OPEN', 'IN_REVIEW'] },
    } satisfies Prisma.ReportWhereInput;

    if (d.decision === 'DISMISS') {
      await this.closeReports(staffId, { id: reportId }, 'DISMISSED', d.statement);
      return;
    }
    const fits =
      (d.decision === 'REMOVE_LISTING' && report.targetType === 'LISTING') ||
      (d.decision === 'HIDE_MESSAGE' && report.targetType === 'MESSAGE') ||
      (d.decision.endsWith('_USER') && !!target?.userId);
    if (!fits || !target) throw new BadRequestException({ code: 'DECISION_NOT_APPLICABLE' });
    const user = d.decision.endsWith('_USER');
    await this.act(staffId, {
      actionType:
        d.decision === 'REMOVE_LISTING'
          ? 'LISTING_REMOVED'
          : d.decision === 'HIDE_MESSAGE'
            ? 'MESSAGE_HIDDEN'
            : SANCTION_ACTION[d.decision.replace('_USER', '') as Sanction],
      targetType: user ? 'USER' : report.targetType,
      targetId: user ? (target.userId as string) : report.targetId,
      targetUserId: target.userId,
      reasonCode: d.reasonCode,
      statement: d.statement,
      legalGround: d.legalGround,
      reportId,
      days: d.days,
    });
    // Every open notice on the same content gets the same decision.
    await this.closeReports(staffId, open, 'ACTION_TAKEN', d.statement);
  }

  private async closeReports(
    staffId: string,
    where: Prisma.ReportWhereInput,
    status: 'ACTION_TAKEN' | 'DISMISSED',
    statement: string,
  ) {
    const reports = await this.db.report.findMany({ where, select: { id: true } });
    await this.db.$transaction(async (tx) => {
      for (const r of reports) {
        await tx.report.update({
          where: { id: r.id },
          data: { status, decision: statement, handledById: staffId, decidedAt: new Date() },
        });
        await writeOutbox(tx, {
          aggregateType: 'Report',
          aggregateId: r.id,
          type: 'report.decided',
          payload: { reportId: r.id },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: staffId,
          action: status === 'DISMISSED' ? 'report.dismiss' : 'report.action',
          entityType: 'Report',
          entityId: reports[0]?.id,
          metadata: { reports: reports.map((r) => r.id), statement },
        },
      });
    });
  }

  // ───────────── Actions ─────────────

  /** Applies a restriction, records the statement of reasons and notifies the affected user. */
  async act(staffId: string | null, a: ActionInput): Promise<string> {
    if (a.targetUserId) {
      const target = await this.db.user.findUnique({
        where: { id: a.targetUserId },
        select: { role: true },
      });
      if (a.actionType.startsWith('USER_') && target && target.role !== 'user')
        throw new ForbiddenException({ code: 'CANNOT_SANCTION_STAFF' });
    }
    return this.db.$transaction(async (tx) => {
      await this.applyEffect(tx, a.actionType, a.targetId, a);
      const action = await tx.moderationAction.create({
        data: {
          moderatorId: staffId,
          actionType: a.actionType,
          targetType: a.targetType,
          targetId: a.targetId,
          targetUserId: a.targetUserId,
          reportId: a.reportId,
          reasonCode: a.reasonCode,
          statementOfReasons: a.statement,
          legalGround: a.legalGround,
          contractualGround: 'Termini di servizio e Regole di pubblicazione',
          appealable: a.actionType !== 'USER_REINSTATED' && a.actionType !== 'LISTING_RESTORED',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: staffId,
          action: `moderation.${a.actionType.toLowerCase()}`,
          entityType: a.targetType,
          entityId: a.targetId,
          metadata: { actionId: action.id, reasonCode: a.reasonCode, reportId: a.reportId ?? null },
        },
      });
      if (a.targetUserId)
        await writeOutbox(tx, {
          aggregateType: 'ModerationAction',
          aggregateId: action.id,
          type: 'moderation.action',
          payload: { actionId: action.id },
        });
      return action.id;
    });
  }

  private listingUpdated(tx: Prisma.TransactionClient, listingId: string) {
    return writeOutbox(tx, {
      aggregateType: 'Listing',
      aggregateId: listingId,
      type: 'listing.updated',
      payload: { listingId },
    });
  }

  private async applyEffect(
    tx: Prisma.TransactionClient,
    type: ModerationActionType,
    targetId: string,
    a: { statement: string; reasonCode: string; days?: number },
  ) {
    const now = new Date();
    switch (type) {
      case 'LISTING_REMOVED':
      case 'LISTING_REJECTED': {
        const l = await tx.listing.findUnique({
          where: { id: targetId },
          select: { status: true },
        });
        if (!l) throw new NotFoundException();
        if (type === 'LISTING_REJECTED' && l.status !== 'PENDING_REVIEW')
          throw new ConflictException({ code: 'LISTING_INVALID_STATE' });
        // A reserved listing has an order in progress: that goes through the order or dispute.
        if (
          type === 'LISTING_REMOVED' &&
          !['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'EXPIRED'].includes(l.status)
        )
          throw new ConflictException({ code: 'LISTING_INVALID_STATE' });
        await tx.listing.update({
          where: { id: targetId },
          data: {
            status: type === 'LISTING_REMOVED' ? 'REMOVED' : 'REJECTED',
            rejectionReason: a.statement,
          },
        });
        return this.listingUpdated(tx, targetId);
      }
      case 'LISTING_RESTORED': {
        const l = await tx.listing.findUnique({ where: { id: targetId } });
        if (!l || !['REMOVED', 'REJECTED', 'PENDING_REVIEW'].includes(l.status) || l.deletedAt)
          throw new ConflictException({ code: 'LISTING_INVALID_STATE' });
        const { durationDays } = await this.settings.get('listings');
        await tx.listing.update({
          where: { id: targetId },
          data: {
            status: 'ACTIVE',
            rejectionReason: null,
            publishedAt: l.publishedAt ?? now,
            bumpedAt: l.bumpedAt ?? now,
            expiresAt:
              l.expiresAt && l.expiresAt > now
                ? l.expiresAt
                : new Date(now.getTime() + durationDays * DAY),
          },
        });
        if (!l.publishedAt)
          await tx.listingPriceHistory.create({
            data: { listingId: targetId, priceCents: l.priceCents },
          });
        return this.listingUpdated(tx, targetId);
      }
      case 'MESSAGE_HIDDEN':
        await tx.message.update({ where: { id: targetId }, data: { isHidden: true } });
        return;
      case 'FEEDBACK_REMOVED':
        return; // FeedbackService applies it (SPEC §8.8)
      case 'USER_WARNED':
        return;
      case 'USER_LIMITED':
        await tx.user.update({ where: { id: targetId }, data: { status: 'LIMITED' } });
        return;
      case 'USER_SUSPENDED':
      case 'USER_BANNED': {
        const suspended = type === 'USER_SUSPENDED';
        await tx.user.update({
          where: { id: targetId },
          data: {
            status: suspended ? 'SUSPENDED' : 'BANNED',
            banned: true,
            banReason: a.reasonCode,
            banExpires: suspended ? new Date(now.getTime() + (a.days ?? 7) * DAY) : null,
          },
        });
        await tx.session.deleteMany({ where: { userId: targetId } });
        // Nothing of theirs stays on sale; reinstated users resume their listings themselves.
        const live = await tx.listing.findMany({
          where: { sellerId: targetId, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        await tx.listing.updateMany({
          where: { id: { in: live.map((l) => l.id) } },
          data: { status: 'PAUSED' },
        });
        for (const l of live) await this.listingUpdated(tx, l.id);
        return;
      }
      case 'USER_REINSTATED':
        await tx.user.update({
          where: { id: targetId },
          data: { status: 'ACTIVE', banned: false, banReason: null, banExpires: null },
        });
        return;
    }
  }

  // ───────────── Staff: listings queue ─────────────

  async adminListings(
    status: 'PENDING_REVIEW' | 'REMOVED' | 'REJECTED' | 'REPORTED',
  ): Promise<AdminListingItem[]> {
    let where: Prisma.ListingWhereInput = { deletedAt: null };
    if (status === 'REPORTED') {
      const ids = await this.db.report.findMany({
        where: { targetType: 'LISTING', status: { in: ['OPEN', 'IN_REVIEW'] } },
        select: { targetId: true },
        distinct: ['targetId'],
      });
      where = { ...where, id: { in: ids.map((r) => r.targetId) } };
    } else where = { ...where, status };
    const rows = await this.db.listing.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: 100,
      include: {
        seller: { select: { id: true, username: true, email: true } },
        images: { orderBy: { position: 'asc' }, take: 1 },
      },
    });
    const reports = await this.db.report.groupBy({
      by: ['targetId'],
      where: { targetType: 'LISTING', targetId: { in: rows.map((r) => r.id) } },
      _count: true,
    });
    const count = new Map(reports.map((r) => [r.targetId, r._count]));
    return rows.map((l) => ({
      id: l.id,
      shortId: l.shortId,
      slug: l.slug,
      title: l.title,
      status: l.status,
      priceCents: l.priceCents,
      seller: l.seller,
      rejectionReason: l.rejectionReason,
      reports: count.get(l.id) ?? 0,
      imageKey: l.images[0]?.width ? l.images[0].storageKey : null,
      updatedAt: l.updatedAt.toISOString(),
    }));
  }

  async approveListing(staffId: string, id: string): Promise<void> {
    const l = await this.db.listing.findUnique({ where: { id } });
    if (l?.status !== 'PENDING_REVIEW')
      throw new ConflictException({ code: 'LISTING_INVALID_STATE' });
    const now = new Date();
    const { durationDays } = await this.settings.get('listings');
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          rejectionReason: null,
          publishedAt: l.publishedAt ?? now,
          bumpedAt: now,
          expiresAt: new Date(now.getTime() + durationDays * DAY),
        },
      });
      if (!l.publishedAt)
        await tx.listingPriceHistory.create({ data: { listingId: id, priceCents: l.priceCents } });
      await tx.auditLog.create({
        data: { actorId: staffId, action: 'listing.approve', entityType: 'Listing', entityId: id },
      });
      await writeOutbox(tx, {
        aggregateType: 'Listing',
        aggregateId: id,
        type: 'listing.approved',
        payload: { listingId: id, sellerId: l.sellerId },
      });
    });
  }

  async listingAction(
    staffId: string,
    id: string,
    type: 'LISTING_REJECTED' | 'LISTING_REMOVED' | 'LISTING_RESTORED',
    input: { reasonCode: string; statement: string; legalGround?: string },
  ) {
    const l = await this.db.listing.findUnique({ where: { id }, select: { sellerId: true } });
    if (!l) throw new NotFoundException();
    return this.act(staffId, {
      actionType: type,
      targetType: 'LISTING',
      targetId: id,
      targetUserId: l.sellerId,
      ...input,
    });
  }

  // ───────────── Appeals ─────────────

  private async actionItem(a: ActionRow, now = new Date()): Promise<ModerationActionItem> {
    const target = await this.describe(a.targetType, a.targetId);
    return {
      id: a.id,
      actionType: a.actionType,
      targetType: a.targetType,
      targetId: a.targetId,
      targetLabel: target?.label ?? '—',
      reasonCode: a.reasonCode,
      statementOfReasons: a.statementOfReasons,
      legalGround: a.legalGround,
      automated: a.automated,
      createdAt: a.createdAt.toISOString(),
      appealable: a.appealable,
      canAppeal:
        a.appealable &&
        !a.appealedAt &&
        !a.reversedAt &&
        now.getTime() - a.createdAt.getTime() < APPEAL_WINDOW_DAYS * DAY,
      appealedAt: a.appealedAt?.toISOString() ?? null,
      appealText: a.appealText,
      appealOutcome: (a.appealOutcome as 'UPHELD' | 'REVERSED' | null) ?? null,
      appealStatement: a.appealStatement,
      appealDecidedAt: a.appealDecidedAt?.toISOString() ?? null,
    };
  }

  async myActions(userId: string): Promise<ModerationActionItem[]> {
    const rows = await this.db.moderationAction.findMany({
      where: { targetUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((a) => this.actionItem(a)));
  }

  /** Internal complaint system (DSA art. 20): once per decision, within 6 months. */
  async appeal(userId: string, actionId: string, text: string): Promise<ModerationActionItem> {
    const a = await this.db.moderationAction.findFirst({
      where: { id: actionId, targetUserId: userId },
    });
    if (!a) throw new NotFoundException();
    if (!(await this.actionItem(a)).canAppeal)
      throw new ConflictException({ code: 'APPEAL_NOT_ALLOWED' });
    const updated = await this.db.$transaction(async (tx) => {
      const { count } = await tx.moderationAction.updateMany({
        where: { id: actionId, appealedAt: null },
        data: { appealedAt: new Date(), appealText: text },
      });
      if (!count) throw new ConflictException({ code: 'APPEAL_NOT_ALLOWED' });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'moderation.appeal',
          entityType: 'ModerationAction',
          entityId: actionId,
        },
      });
      return tx.moderationAction.findUniqueOrThrow({ where: { id: actionId } });
    });
    return this.actionItem(updated);
  }

  async adminAppeals(): Promise<AdminAppealItem[]> {
    const rows = await this.db.moderationAction.findMany({
      where: { appealedAt: { not: null }, appealDecidedAt: null },
      orderBy: { appealedAt: 'asc' },
      take: 100,
    });
    return Promise.all(
      rows.map(async (a) => ({
        ...(await this.actionItem(a)),
        moderatorId: a.moderatorId,
        targetUser: a.targetUserId
          ? await this.db.user.findUnique({
              where: { id: a.targetUserId },
              select: { id: true, email: true, username: true },
            })
          : null,
      })),
    );
  }

  /** Reviewed by someone other than the original moderator; a reversal undoes the restriction. */
  async decideAppeal(
    staffId: string,
    actionId: string,
    outcome: 'UPHELD' | 'REVERSED',
    statement: string,
  ) {
    const a = await this.db.moderationAction.findUnique({ where: { id: actionId } });
    if (!a?.appealedAt) throw new NotFoundException();
    if (a.appealDecidedAt) throw new ConflictException({ code: 'APPEAL_ALREADY_DECIDED' });
    if (a.moderatorId === staffId) throw new ForbiddenException({ code: 'SAME_REVIEWER' });
    await this.db.$transaction(async (tx) => {
      if (outcome === 'REVERSED') await this.reverse(tx, a);
      await tx.moderationAction.update({
        where: { id: actionId },
        data: {
          appealOutcome: outcome,
          appealStatement: statement,
          appealDecidedAt: new Date(),
          appealReviewerId: staffId,
          ...(outcome === 'REVERSED' ? { reversedAt: new Date() } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: staffId,
          action: `moderation.appeal_${outcome.toLowerCase()}`,
          entityType: 'ModerationAction',
          entityId: actionId,
        },
      });
      await writeOutbox(tx, {
        aggregateType: 'ModerationAction',
        aggregateId: actionId,
        type: 'moderation.appeal_decided',
        payload: { actionId },
      });
    });
  }

  private async reverse(tx: Prisma.TransactionClient, a: ActionRow) {
    switch (a.actionType) {
      case 'LISTING_REMOVED':
      case 'LISTING_REJECTED':
        return this.applyEffect(tx, 'LISTING_RESTORED', a.targetId, {
          statement: '',
          reasonCode: '',
        });
      case 'MESSAGE_HIDDEN':
        await tx.message.update({ where: { id: a.targetId }, data: { isHidden: false } });
        return;
      case 'FEEDBACK_REMOVED':
        await tx.feedback.update({
          where: { id: a.targetId },
          data: { status: 'PUBLISHED', removedReason: null, removedById: null },
        });
        return writeOutbox(tx, {
          aggregateType: 'Feedback',
          aggregateId: a.targetId,
          type: 'feedback.published',
          payload: { feedbackId: a.targetId },
        });
      case 'USER_LIMITED':
      case 'USER_SUSPENDED':
      case 'USER_BANNED':
        return this.applyEffect(tx, 'USER_REINSTATED', a.targetId, {
          statement: '',
          reasonCode: '',
        });
      default:
        return;
    }
  }

  // ───────────── Staff: users ─────────────

  private userItem(u: Prisma.UserGetPayload<object>): AdminUserItem {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      username: u.username,
      role: u.role,
      status: u.status,
      banExpires: u.banExpires?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      twoFactorEnabled: u.twoFactorEnabled,
    };
  }

  async adminUsers(q: string | undefined): Promise<AdminUserItem[]> {
    const term = q?.trim().slice(0, 100);
    const rows = await this.db.user.findMany({
      where: term
        ? {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { username: { contains: term.toLowerCase().replace(/^@/, '') } },
              { name: { contains: term, mode: 'insensitive' } },
              ...(/^[0-9a-f-]{36}$/i.test(term) ? [{ id: term }] : []),
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((u) => this.userItem(u));
  }

  async adminUser(id: string): Promise<AdminUserDetail> {
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException();
    const [listings, purchases, sales, reportsAgainst, flaggedMessages, actions] =
      await Promise.all([
        this.db.listing.count({ where: { sellerId: id, deletedAt: null } }),
        this.db.order.count({ where: { buyerId: id } }),
        this.db.order.count({ where: { sellerId: id } }),
        this.db.report.count({
          where: {
            OR: [
              { targetType: 'USER', targetId: id },
              {
                targetType: 'LISTING',
                targetId: {
                  in: (
                    await this.db.listing.findMany({
                      where: { sellerId: id },
                      select: { id: true },
                    })
                  ).map((l) => l.id),
                },
              },
            ],
          },
        }),
        this.db.message.count({ where: { senderId: id, flags: { isEmpty: false } } }),
        this.db.moderationAction.findMany({
          where: { targetUserId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);
    return {
      ...this.userItem(u),
      accountType: u.accountType,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      counts: { listings, purchases, sales, reportsAgainst, flaggedMessages },
      actions: await Promise.all(actions.map((a) => this.actionItem(a))),
    };
  }

  sanction(
    staffId: string,
    userId: string,
    s: {
      type: Sanction;
      reasonCode: string;
      statement: string;
      legalGround?: string;
      days: number;
    },
  ) {
    return this.act(staffId, {
      actionType: SANCTION_ACTION[s.type],
      targetType: 'USER',
      targetId: userId,
      targetUserId: userId,
      reasonCode: s.reasonCode,
      statement: s.statement,
      legalGround: s.legalGround,
      days: s.days,
    });
  }

  async reinstate(staffId: string, userId: string, statement: string) {
    const u = await this.db.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!u || u.status === 'DELETED') throw new NotFoundException();
    if (u.status === 'ACTIVE') throw new ConflictException({ code: 'USER_NOT_SANCTIONED' });
    return this.act(staffId, {
      actionType: 'USER_REINSTATED',
      targetType: 'USER',
      targetId: userId,
      targetUserId: userId,
      reasonCode: 'REINSTATED',
      statement,
    });
  }
}
