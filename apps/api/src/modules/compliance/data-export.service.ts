import type { PrismaClient } from '@accordo/db';
import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { FieldCrypto } from './field-crypto.js';

/**
 * GDPR art. 15/20 (SPEC §14.5): everything we hold about the user, as JSON. Secrets that are not
 * personal data (password hashes, session tokens, device hashes) are left out.
 * ponytail: built synchronously; move to a worker job with an emailed link if exports get large.
 */
@Injectable()
export class DataExportService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly crypto: FieldCrypto,
    private readonly rateLimit: RateLimitService,
  ) {}

  async export(userId: string, meta: { ip?: string; userAgent?: string }) {
    await this.rateLimit.consume(`data-export:${userId}`, 5, 24 * 3600);
    const db = this.db;
    const mine = { userId };
    const conversations = await db.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        listing: { select: { id: true, title: true } },
        messages: {
          where: { isHidden: false },
          select: {
            id: true,
            senderId: true,
            type: true,
            body: true,
            flags: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const [
      user,
      addresses,
      listings,
      favorites,
      savedSearches,
      recentlyViewed,
      following,
      offers,
      purchases,
      sales,
      feedbackGiven,
      feedbackReceived,
      reputation,
      notifications,
      notificationPreferences,
      reports,
      moderationActions,
      shop,
      paymentAccount,
      devices,
      sessions,
      activity,
      tax,
    ] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        omit: { banReason: true },
        include: { comune: { select: { name: true } } },
      }),
      db.address.findMany({ where: mine }),
      db.listing.findMany({
        where: { sellerId: userId },
        include: { images: { select: { storageKey: true, position: true } }, priceHistory: true },
      }),
      db.favorite.findMany({ where: mine }),
      db.savedSearch.findMany({ where: mine }),
      db.recentlyViewed.findMany({ where: mine }),
      db.follow.findMany({ where: { followerId: userId } }),
      db.offer.findMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      db.order.findMany({ where: { buyerId: userId }, include: { shipments: true } }),
      db.order.findMany({ where: { sellerId: userId }, include: { shipments: true } }),
      db.feedback.findMany({ where: { authorId: userId } }),
      db.feedback.findMany({ where: { recipientId: userId } }),
      db.userReputation.findUnique({ where: mine }),
      db.notification.findMany({ where: mine, orderBy: { createdAt: 'desc' } }),
      db.notificationPreference.findMany({ where: mine }),
      db.report.findMany({ where: { reporterId: userId } }),
      db.moderationAction.findMany({
        where: { targetUserId: userId },
        omit: { moderatorId: true, appealReviewerId: true },
      }),
      db.shop.findUnique({ where: { ownerId: userId } }),
      db.paymentAccount.findUnique({
        where: mine,
        select: { provider: true, transfersEnabled: true, createdAt: true },
      }),
      db.knownDevice.findMany({ where: mine, omit: { deviceIdHash: true } }),
      db.session.findMany({ where: mine, omit: { token: true } }),
      db.auditLog.findMany({
        where: { actorId: userId },
        select: {
          action: true,
          entityType: true,
          ip: true,
          userAgent: true,
          createdAt: true,
          metadata: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.taxProfile.findUnique({ where: mine }),
    ]);
    const dec = (v: string | null) => (v ? this.crypto.decrypt(v) : null);
    const taxProfile = tax && {
      legalName: tax.legalName,
      taxId: dec(tax.taxIdEnc),
      birthDate: dec(tax.birthDateEnc),
      vatNumber: tax.vatNumber,
      address: { line: tax.addressLine, cap: tax.cap, city: tax.city, country: tax.country },
      iban: dec(tax.ibanEnc),
      collectedAt: tax.collectedAt,
    };
    await db.auditLog.create({
      data: {
        actorId: userId,
        action: 'gdpr.export',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      format: 'accordo-data-export/1',
      user,
      addresses,
      listings,
      favorites,
      savedSearches,
      recentlyViewed,
      following,
      conversations,
      offers,
      orders: { purchases, sales },
      feedback: { given: feedbackGiven, received: feedbackReceived, reputation },
      notifications,
      notificationPreferences,
      reports,
      moderationActions,
      shop,
      paymentAccount,
      devices,
      sessions,
      activity,
      taxProfile,
    };
  }
}
