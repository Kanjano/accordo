import type { Prisma, PrismaClient } from '@accordo/db';
import {
  applyRevision,
  canLeaveFeedback,
  type DeliveryMethod,
  DSR_MIN_DISPLAY_COUNT,
  type FeedbackRating,
  maskUsername,
  moderateFeedbackText,
  REVISION_RESPONSE_DAYS,
  responseTimeBucket,
  revisionRequestErrors,
  validateFeedbackInput,
  weekKey,
} from '@accordo/domain';
import type {
  FeedbackCreate,
  FeedbackItem,
  PendingFeedback,
  ReputationDto,
  RevisionRequestItem,
} from '@accordo/shared';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SettingsService } from '../platform/settings.service.js';

const DAY = 86_400_000;

const feedbackInclude = {
  author: { select: { username: true, name: true, reputation: { select: { score: true } } } },
  recipient: { select: { username: true, name: true } },
  order: { select: { listingSnapshot: true, number: true } },
  revisionRequest: { select: { id: true } },
} satisfies Prisma.FeedbackInclude;
type FeedbackRow = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>;

/** SPEC §8: leaving, replying, revisions, reports, public aggregates and lists. */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private toItem(f: FeedbackRow, viewerId: string | null): FeedbackItem {
    const actions: FeedbackItem['actions'] = [];
    if (viewerId && f.recipientId === viewerId && f.status === 'PUBLISHED') {
      if (!f.reply) actions.push('reply');
      if (f.role === 'BUYER_TO_SELLER' && f.rating !== 'POSITIVE' && !f.revisionRequest)
        actions.push('requestRevision');
    }
    if (viewerId && f.authorId !== viewerId) actions.push('report');
    return {
      id: f.id,
      orderId: f.orderId,
      role: f.role,
      rating: f.rating,
      comment: f.comment,
      dsr: {
        itemAsDescribed: f.dsrItemAsDescribed,
        communication: f.dsrCommunication,
        shippingTime: f.dsrShippingTime,
        packaging: f.dsrPackaging,
      },
      author: {
        name: maskUsername(f.author.username ?? f.author.name),
        score: f.author.reputation?.score ?? 0,
      },
      recipient: { name: f.recipient.username ?? f.recipient.name },
      listingTitle: (f.order.listingSnapshot as { title?: string }).title ?? f.order.number,
      reply: f.reply,
      revised: !!f.revisedAt,
      countsTowardScore: f.countsTowardScore,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
      actions,
    };
  }

  private async outbox(
    tx: Prisma.TransactionClient,
    type: string,
    f: { id: string; recipientId: string; authorId: string; orderId: string },
    extra: object = {},
  ) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Feedback',
        aggregateId: f.id,
        type,
        payload: {
          feedbackId: f.id,
          recipientId: f.recipientId,
          authorId: f.authorId,
          orderId: f.orderId,
          ...extra,
        },
      },
    });
  }

  // ───────────── Leaving feedback (§8.1–8.2) ─────────────

  async leave(userId: string, orderId: string, input: FeedbackCreate): Promise<FeedbackItem> {
    const o = await this.db.order.findFirst({
      where: { id: orderId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!o) throw new NotFoundException();
    const { windowDays, minOrderCents } = await this.settings.get('feedback');
    const can = canLeaveFeedback(o, new Date(), {
      feedbackWindowDays: windowDays,
      feedbackMinOrderCents: minOrderCents,
    });
    if (!can.ok) throw new ConflictException({ code: can.reason });
    const role = o.buyerId === userId ? 'BUYER_TO_SELLER' : 'SELLER_TO_BUYER';
    const dsr = input.dsr ?? {};
    const errors = validateFeedbackInput({
      role,
      rating: input.rating,
      comment: input.comment,
      dsr,
      deliveryMethod: o.deliveryMethod as DeliveryMethod,
    });
    if (errors.length)
      throw new UnprocessableEntityException({ code: errors[0], detail: errors.join(',') });
    // Automatic checks (§8.8): contacts, links, personal data, insults → review first.
    const flags = input.comment
      ? moderateFeedbackText(input.comment, await this.settings.get('feedbackInsults'))
      : [];
    try {
      const created = await this.db.$transaction(async (tx) => {
        const f = await tx.feedback.create({
          data: {
            orderId,
            authorId: userId,
            recipientId: role === 'BUYER_TO_SELLER' ? o.sellerId : o.buyerId,
            role,
            rating: input.rating,
            comment: input.comment?.trim() || null,
            dsrItemAsDescribed: dsr.itemAsDescribed ?? null,
            dsrCommunication: dsr.communication ?? null,
            dsrShippingTime: dsr.shippingTime ?? null,
            dsrPackaging: dsr.packaging ?? null,
            weekKey: weekKey(o.completedAt as Date),
            status: flags.length ? 'HIDDEN' : 'PUBLISHED',
          },
        });
        await this.outbox(tx, 'feedback.created', f, { flags });
        return f;
      });
      // Relations loaded after the commit: Prisma resolves `include` with parallel queries,
      // which a single transaction connection must not receive.
      return this.toItem(
        await this.db.feedback.findUniqueOrThrow({
          where: { id: created.id },
          include: feedbackInclude,
        }),
        userId,
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException({ code: 'FEEDBACK_EXISTS' });
      throw e;
    }
  }

  async reply(userId: string, id: string, body: string): Promise<FeedbackItem> {
    const f = await this.db.feedback.findFirst({
      where: { id, recipientId: userId, status: 'PUBLISHED' },
    });
    if (!f) throw new NotFoundException();
    if (f.reply) throw new ConflictException({ code: 'ALREADY_REPLIED' });
    if (moderateFeedbackText(body, await this.settings.get('feedbackInsults')).length)
      throw new UnprocessableEntityException({ code: 'TEXT_NOT_ALLOWED' });
    await this.db.feedback.update({ where: { id }, data: { reply: body, repliedAt: new Date() } });
    return this.toItem(
      await this.db.feedback.findUniqueOrThrow({ where: { id }, include: feedbackInclude }),
      userId,
    );
  }

  // ───────────── Revisions (§8.3) ─────────────

  async requestRevision(userId: string, id: string, message: string) {
    const f = await this.db.feedback.findFirst({
      where: { id, recipientId: userId, role: 'BUYER_TO_SELLER', status: 'PUBLISHED' },
      include: { revisionRequest: true },
    });
    if (!f) throw new NotFoundException();
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const [requestsThisYear, received12m] = await Promise.all([
      this.db.feedbackRevisionRequest.count({
        where: { requesterId: userId, createdAt: { gte: yearStart } },
      }),
      this.db.feedback.count({
        where: {
          recipientId: userId,
          status: 'PUBLISHED',
          createdAt: { gte: new Date(now.getTime() - 365 * DAY) },
        },
      }),
    ]);
    const errors = revisionRequestErrors({
      rating: f.rating,
      feedbackCreatedAt: f.createdAt,
      now,
      alreadyRequestedForOrder: !!f.revisionRequest,
      requestsThisYear,
      feedbackReceived12m: received12m,
    });
    if (errors.length) throw new ConflictException({ code: errors[0] });
    await this.db.$transaction(async (tx) => {
      await tx.feedbackRevisionRequest.create({
        data: {
          feedbackId: id,
          requesterId: userId,
          message,
          expiresAt: new Date(now.getTime() + REVISION_RESPONSE_DAYS * DAY),
        },
      });
      await this.notifyOrder(tx, f.orderId, 'feedback.revision_requested', ['BUYER']);
    });
    return this.requests(userId);
  }

  async answerRevision(
    userId: string,
    requestId: string,
    accept: boolean,
    revised?: { rating: FeedbackRating; comment?: string },
  ) {
    const r = await this.db.feedbackRevisionRequest.findFirst({
      where: { id: requestId, feedback: { authorId: userId } },
      include: { feedback: { include: { order: { select: { deliveryMethod: true } } } } },
    });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING' || r.expiresAt < new Date())
      throw new ConflictException({ code: 'REVISION_NOT_PENDING' });
    const f = r.feedback;
    await this.db.$transaction(async (tx) => {
      await tx.feedbackRevisionRequest.update({
        where: { id: r.id },
        data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
      });
      if (!accept || !revised) return;
      let next: ReturnType<typeof applyRevision>;
      try {
        next = applyRevision(
          { rating: f.rating, comment: f.comment },
          { rating: revised.rating, comment: revised.comment?.trim() || null },
        );
      } catch {
        throw new UnprocessableEntityException({ code: 'REVISION_WORSE' });
      }
      const errors = validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: next.rating,
        comment: next.comment,
        dsr: {
          itemAsDescribed: f.dsrItemAsDescribed,
          communication: f.dsrCommunication,
          shippingTime: f.dsrShippingTime,
          packaging: f.dsrPackaging,
        },
        deliveryMethod: f.order.deliveryMethod as DeliveryMethod,
      });
      if (errors.length) throw new UnprocessableEntityException({ code: errors[0] });
      const flags = next.comment
        ? moderateFeedbackText(next.comment, await this.settings.get('feedbackInsults'))
        : [];
      await tx.feedback.update({
        where: { id: f.id },
        data: { ...next, revisedAt: new Date(), ...(flags.length ? { status: 'HIDDEN' } : {}) },
      });
      await this.outbox(tx, 'feedback.revised', f);
    });
    return this.requests(userId);
  }

  async requests(userId: string): Promise<RevisionRequestItem[]> {
    const rows = await this.db.feedbackRevisionRequest.findMany({
      where: { OR: [{ requesterId: userId }, { feedback: { authorId: userId } }] },
      include: { feedback: { include: { order: { select: { listingSnapshot: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      feedbackId: r.feedbackId,
      message: r.message,
      status: r.status === 'PENDING' && r.expiresAt < new Date() ? 'EXPIRED' : r.status,
      expiresAt: r.expiresAt.toISOString(),
      listingTitle: (r.feedback.order.listingSnapshot as { title?: string }).title ?? '',
      rating: r.feedback.rating,
      comment: r.feedback.comment,
      mine: r.feedback.authorId === userId,
    }));
  }

  async report(userId: string, id: string, reasonCode: string, details: string) {
    const f = await this.db.feedback.findFirst({ where: { id, status: { not: 'REMOVED' } } });
    if (!f || f.authorId === userId) throw new NotFoundException();
    await this.rateLimit.consume(`report:${userId}`, 10, 24 * 3600);
    await this.db.report.create({
      data: {
        reporterId: userId,
        targetType: 'FEEDBACK',
        targetId: id,
        reasonCode,
        details,
        goodFaithConfirmed: true,
      },
    });
  }

  private notifyOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    template: string,
    to: string[],
  ) {
    return tx.outboxEvent.create({
      data: {
        aggregateType: 'Order',
        aggregateId: orderId,
        type: 'order.effects',
        payload: {
          orderId,
          eventId: `${template}:${Date.now()}`,
          effects: [{ type: 'NOTIFY', template, to }],
        },
      },
    });
  }

  // ───────────── Reads (§8.9) ─────────────

  private async userByName(username: string) {
    const u = await this.db.user.findFirst({
      where: { username: username.toLowerCase(), status: { not: 'DELETED' } },
      include: { reputation: true },
    });
    if (!u?.username) throw new NotFoundException();
    return u;
  }

  async reputation(username: string): Promise<ReputationDto> {
    const u = await this.userByName(username);
    const rep = u.reputation;
    const now = Date.now();
    const period = async (days: number) => {
      const rows = await this.db.feedback.groupBy({
        by: ['rating'],
        where: {
          recipientId: u.id,
          role: 'BUYER_TO_SELLER',
          status: 'PUBLISHED',
          countsTowardScore: true,
          createdAt: { gte: new Date(now - days * DAY) },
        },
        _count: true,
      });
      const n = (r: string) => rows.find((x) => x.rating === r)?._count ?? 0;
      return { positive: n('POSITIVE'), neutral: n('NEUTRAL'), negative: n('NEGATIVE') };
    };
    const [m1, m6, m12] = await Promise.all([period(30), period(182), period(365)]);
    const dsr = (avg: unknown, count: number | undefined) =>
      count && count >= DSR_MIN_DISPLAY_COUNT && avg != null ? { avg: Number(avg), count } : null;
    return {
      userId: u.id,
      username: u.username as string,
      score: rep?.score ?? 0,
      levelKey: rep?.levelKey ?? null,
      sellerPositivePctBps: rep?.sellerPositivePctBps ?? null,
      periods: { m1, m6, m12 },
      dsr: {
        itemAsDescribed: dsr(rep?.dsrItemAsDescribedAvg, rep?.dsrItemAsDescribedCount),
        communication: dsr(rep?.dsrCommunicationAvg, rep?.dsrCommunicationCount),
        shippingTime: dsr(rep?.dsrShippingTimeAvg, rep?.dsrShippingTimeCount),
        packaging: dsr(rep?.dsrPackagingAvg, rep?.dsrPackagingCount),
      },
      topSeller: !!rep?.isTopSeller,
      completedSales: rep?.completedSales ?? 0,
      completedPurchases: rep?.completedPurchases ?? 0,
      responseTime: responseTimeBucket(rep?.medianResponseMinutes ?? null),
      responseRateBps: rep?.responseRateBps ?? null,
    };
  }

  async list(
    username: string,
    viewerId: string | null,
    q: { role?: string; rating?: string; period?: string; cursor?: string },
  ) {
    const u = await this.userByName(username);
    const days = { '1m': 30, '6m': 182, '12m': 365 }[q.period ?? ''] ?? null;
    const where: Prisma.FeedbackWhereInput = {
      status: 'PUBLISHED',
      ...(q.role === 'left'
        ? { authorId: u.id }
        : { recipientId: u.id, role: q.role === 'buyer' ? 'SELLER_TO_BUYER' : 'BUYER_TO_SELLER' }),
      ...(q.rating && ['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(q.rating)
        ? { rating: q.rating as FeedbackRating }
        : {}),
      ...(days ? { createdAt: { gte: new Date(Date.now() - days * DAY) } } : {}),
    };
    const rows = await this.db.feedback.findMany({
      where,
      include: feedbackInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      ...(q.cursor && /^[0-9a-f-]{36}$/i.test(q.cursor)
        ? { cursor: { id: q.cursor }, skip: 1 }
        : {}),
    });
    const items = rows.slice(0, 20);
    return {
      items: items.map((f) => this.toItem(f, viewerId)),
      nextCursor: rows.length > 20 ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async pending(userId: string): Promise<PendingFeedback[]> {
    const { windowDays } = await this.settings.get('feedback');
    const orders = await this.db.order.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: new Date(Date.now() - windowDays * DAY) },
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      include: {
        feedback: { select: { authorId: true } },
        buyer: { select: { name: true } },
        seller: { select: { name: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 100,
    });
    return orders
      .filter((o) => !o.feedback.some((f) => f.authorId === userId))
      .map((o) => ({
        orderId: o.id,
        orderNumber: o.number,
        role: o.buyerId === userId ? 'BUYER_TO_SELLER' : 'SELLER_TO_BUYER',
        counterpart: o.buyerId === userId ? o.seller.name : o.buyer.name,
        listingTitle: (o.listingSnapshot as { title?: string }).title ?? o.number,
        deliveryMethod: o.deliveryMethod,
        deadline: new Date((o.completedAt as Date).getTime() + windowDays * DAY).toISOString(),
      }));
  }

  /** "Il mio account → Feedback": received (also hidden ones) and left. */
  async mine(userId: string, kind: 'received' | 'left') {
    const rows = await this.db.feedback.findMany({
      where: kind === 'received' ? { recipientId: userId } : { authorId: userId },
      include: feedbackInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((f) => this.toItem(f, userId));
  }

  // ───────────── Moderation (§8.8) ─────────────

  async moderationQueue() {
    const reported = await this.db.report.findMany({
      where: { targetType: 'FEEDBACK', status: 'OPEN' },
      select: { targetId: true },
    });
    const rows = await this.db.feedback.findMany({
      where: {
        OR: [
          { status: 'HIDDEN' },
          { id: { in: reported.map((r) => r.targetId) }, status: 'PUBLISHED' },
        ],
      },
      include: feedbackInclude,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((f) => ({
      ...this.toItem(f, null),
      reports: reported.filter((r) => r.targetId === f.id).length,
    }));
  }

  /** Removal with a statement of reasons (ModerationAction) and notice to both parties. */
  async remove(staffId: string, id: string, reasonCode: string, statement: string) {
    const f = await this.db.feedback.findUnique({ where: { id } });
    if (!f || f.status === 'REMOVED') throw new NotFoundException();
    await this.db.$transaction(async (tx) => {
      await tx.feedback.update({
        where: { id },
        data: { status: 'REMOVED', removedReason: reasonCode, removedById: staffId },
      });
      await tx.moderationAction.create({
        data: {
          moderatorId: staffId,
          actionType: 'FEEDBACK_REMOVED',
          targetType: 'FEEDBACK',
          targetId: id,
          targetUserId: f.authorId,
          reasonCode,
          statementOfReasons: statement,
        },
      });
      await tx.report.updateMany({
        where: { targetType: 'FEEDBACK', targetId: id, status: 'OPEN' },
        data: {
          status: 'ACTION_TAKEN',
          handledById: staffId,
          decidedAt: new Date(),
          decision: reasonCode,
        },
      });
      await this.outbox(tx, 'feedback.removed', f, { reasonCode, statement });
    });
  }

  /** A hidden feedback that passes review is published; open reports are dismissed. */
  async publish(staffId: string, id: string) {
    const f = await this.db.feedback.findUnique({ where: { id } });
    if (!f || f.status === 'REMOVED') throw new NotFoundException();
    if (f.authorId === staffId) throw new ForbiddenException();
    await this.db.$transaction(async (tx) => {
      await tx.feedback.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await tx.report.updateMany({
        where: { targetType: 'FEEDBACK', targetId: id, status: 'OPEN' },
        data: { status: 'DISMISSED', handledById: staffId, decidedAt: new Date() },
      });
      await this.outbox(tx, 'feedback.published', f);
    });
  }
}
