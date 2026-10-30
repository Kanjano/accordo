import type { Prisma, PrismaClient } from '@accordo/db';
import { isSuspiciousMessagingPattern, scanMessage, shouldMaskContacts } from '@accordo/domain';
import type {
  ConversationDetail,
  ConversationSummary,
  MessageItem,
  messageReportSchema,
  Page,
} from '@accordo/shared';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import {
  type ConversationRow,
  conversationInclude,
  toMessage,
  toOffer,
  toSummary,
  WARN_FLAGS,
} from './mappers.js';

const DAY = 86_400_000;
const PAGE = 50;

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private readonly platformDomain: string;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly realtime: RealtimeGateway,
  ) {
    this.platformDomain = new URL(env.WEB_URL).hostname;
  }

  // ───────────── Guards ─────────────

  /** Participant check with a uniform 404 (anti-IDOR). */
  async participant(userId: string, conversationId: string): Promise<ConversationRow> {
    const c = await this.db.conversation.findFirst({
      where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: conversationInclude,
    });
    if (!c) throw new NotFoundException();
    return c;
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    return (
      (await this.db.userBlock.count({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      })) > 0
    );
  }

  /** LIMITED accounts (SPEC §13.4) may still reply, but not open conversations or make offers. */
  async assertCanInitiate(userId: string, otherId: string): Promise<{ createdAt: Date }> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, createdAt: true },
    });
    if (user.status !== 'ACTIVE') throw new ForbiddenException({ code: 'ACCOUNT_LIMITED' });
    if (await this.isBlocked(userId, otherId))
      throw new ForbiddenException({ code: 'USER_BLOCKED' });
    return user;
  }

  /** The conversation for (listing, buyer), created on first contact. */
  async ensureConversation(
    tx: Prisma.TransactionClient,
    listing: { id: string; sellerId: string },
    buyerId: string,
  ) {
    return tx.conversation.upsert({
      where: { listingId_buyerId: { listingId: listing.id, buyerId } },
      create: { listingId: listing.id, buyerId, sellerId: listing.sellerId },
      update: {},
    });
  }

  // ───────────── Conversations ─────────────

  async start(userId: string, listingId: string, body: string): Promise<{ id: string }> {
    const listing = await this.db.listing.findFirst({
      where: { id: listingId, deletedAt: null, status: { in: ['ACTIVE', 'RESERVED'] } },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException();
    if (listing.sellerId === userId) throw new ConflictException({ code: 'OWN_LISTING' });
    const user = await this.assertCanInitiate(userId, listing.sellerId);
    const existing = await this.db.conversation.findUnique({
      where: { listingId_buyerId: { listingId, buyerId: userId } },
      select: { id: true },
    });
    if (!existing) {
      // SPEC §13.2: 30 new conversations a day, 10 for accounts younger than 7 days.
      const young = Date.now() - user.createdAt.getTime() < 7 * DAY;
      await this.rateLimit.consume(`conversation-new:${userId}`, young ? 10 : 30, 24 * 3600);
    }
    const conversation =
      existing ??
      (await this.db.$transaction((tx) => this.ensureConversation(tx, listing, userId)));
    await this.send(userId, conversation.id, body);
    return { id: conversation.id };
  }

  async list(
    userId: string,
    archived: boolean,
    cursor?: string,
  ): Promise<Page<ConversationSummary>> {
    const rows = await this.db.conversation.findMany({
      where: {
        OR: [
          { buyerId: userId, buyerArchivedAt: archived ? { not: null } : null },
          { sellerId: userId, sellerArchivedAt: archived ? { not: null } : null },
        ],
      },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, PAGE);
    return {
      items: items.map((c) => toSummary(c, userId)),
      nextCursor: rows.length > PAGE ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /** Conversations with unread messages (header badge). */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.db.conversation.count({
      where: {
        OR: [
          { buyerId: userId, buyerUnread: { gt: 0 } },
          { sellerId: userId, sellerUnread: { gt: 0 } },
        ],
      },
    });
    return { count };
  }

  async detail(userId: string, id: string): Promise<ConversationDetail> {
    const c = await this.participant(userId, id);
    const [blocked, offers] = await Promise.all([
      this.isBlocked(c.buyerId, c.sellerId),
      this.db.offer.findMany({
        where: { listingId: c.listingId, buyerId: c.buyerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { ...toSummary(c, userId), blocked, offers: offers.map(toOffer) };
  }

  async messages(userId: string, id: string, cursor?: string): Promise<Page<MessageItem>> {
    await this.participant(userId, id);
    const rows = await this.db.message.findMany({
      where: { conversationId: id, isHidden: false },
      include: { offer: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, PAGE);
    return {
      items: items.map(toMessage),
      nextCursor: rows.length > PAGE ? (items.at(-1)?.id ?? null) : null,
    };
  }

  // ───────────── Messages ─────────────

  async send(userId: string, conversationId: string, body: string): Promise<MessageItem> {
    const c = await this.participant(userId, conversationId);
    const isBuyer = c.buyerId === userId;
    const recipientId = isBuyer ? c.sellerId : c.buyerId;
    if (await this.isBlocked(userId, recipientId))
      throw new ForbiddenException({ code: 'USER_BLOCKED' });
    await this.rateLimit.consume(`message:${userId}`, 30, 60);

    const [sender, recipientWrote] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } }),
      this.db.message.count({ where: { conversationId, senderId: recipientId } }),
    ]);
    const scan = scanMessage(body, { platformDomain: this.platformDomain });
    const mask = shouldMaskContacts({
      bothPartiesHaveWritten: recipientWrote > 0,
      senderAccountAgeDays: (Date.now() - sender.createdAt.getTime()) / DAY,
    });
    const previousUnread = isBuyer ? c.sellerUnread : c.buyerUnread;

    const message = await this.db.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          type: 'TEXT',
          // Masked contacts are never stored in clear (ADR-0034).
          body: mask ? scan.maskedText : body,
          flags: scan.flags,
        },
        include: { offer: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: m.createdAt,
          ...(isBuyer
            ? { sellerUnread: { increment: 1 }, sellerArchivedAt: null }
            : { buyerUnread: { increment: 1 }, buyerArchivedAt: null }),
        },
      });
      await writeOutbox(tx, {
        aggregateType: 'Message',
        aggregateId: m.id,
        type: 'message.created',
        payload: {
          messageId: m.id,
          conversationId,
          recipientId,
          firstUnread: previousUnread === 0,
        },
      });
      return m;
    });

    if (scan.flags.some((f) => WARN_FLAGS.includes(f))) await this.checkSuspicious(userId);
    const dto = toMessage(message);
    this.realtime.emit([c.buyerId, c.sellerId], 'message:new', { conversationId, message: dto });
    return dto;
  }

  /** 5+ warned messages in 24 h towards different conversations → LIMITED + staff review. */
  private async checkSuspicious(userId: string) {
    const now = new Date();
    const flagged = await this.db.message.findMany({
      where: {
        senderId: userId,
        createdAt: { gte: new Date(now.getTime() - DAY) },
        flags: { hasSome: WARN_FLAGS },
      },
      select: { conversationId: true, createdAt: true },
    });
    if (!isSuspiciousMessagingPattern(flagged, now)) return;
    const { count } = await this.db.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: { status: 'LIMITED' },
    });
    if (count) {
      this.logger.warn(`User ${userId} limited: suspicious messaging pattern`);
      await this.db.auditLog.create({
        data: {
          actorId: null,
          action: 'user.limited',
          entityType: 'User',
          entityId: userId,
          metadata: { reason: 'SUSPICIOUS_MESSAGING', conversations: flagged.length },
        },
      });
    }
  }

  async markRead(userId: string, id: string): Promise<void> {
    const c = await this.participant(userId, id);
    const isBuyer = c.buyerId === userId;
    await this.db.$transaction([
      this.db.conversation.update({
        where: { id },
        data: isBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 },
      }),
      this.db.message.updateMany({
        where: { conversationId: id, senderId: { not: userId }, readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    this.realtime.emit([isBuyer ? c.sellerId : c.buyerId], 'conversation:read', {
      conversationId: id,
      readerId: userId,
    });
  }

  async archive(userId: string, id: string, on: boolean): Promise<void> {
    const c = await this.participant(userId, id);
    const at = on ? new Date() : null;
    await this.db.conversation.update({
      where: { id },
      data: c.buyerId === userId ? { buyerArchivedAt: at } : { sellerArchivedAt: at },
    });
  }

  /** Report someone else's message to the staff (SPEC §3.5). */
  async report(
    userId: string,
    messageId: string,
    input: z.infer<typeof messageReportSchema>,
  ): Promise<void> {
    const m = await this.db.message.findFirst({
      where: {
        id: messageId,
        senderId: { not: userId },
        conversation: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      },
      select: { id: true },
    });
    if (!m) throw new NotFoundException();
    await this.rateLimit.consume(`report:${userId}`, 10, 24 * 3600);
    await this.db.report.create({
      data: {
        reporterId: userId,
        targetType: 'MESSAGE',
        targetId: m.id,
        reasonCode: input.reasonCode,
        details: input.details,
        goodFaithConfirmed: true,
      },
    });
  }
}
