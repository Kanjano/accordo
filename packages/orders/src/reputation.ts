import type { PrismaClient } from '@accordo/db';
import {
  computeReputation,
  countableFeedbackIds,
  DEFAULT_REPUTATION_SETTINGS,
  DEFAULT_TOP_SELLER_SETTINGS,
  type FeedbackRecord,
  type ReputationSettings,
  responseMetrics,
  suspiciousPairs,
  type TopSellerSettings,
  unmetTopSellerRequirements,
} from '@accordo/domain';

const DAY = 86_400_000;

async function settings(db: PrismaClient) {
  const rows = await db.platformSetting.findMany({
    where: { key: { in: ['feedback', 'topSeller'] } },
  });
  const feedback = rows.find((r) => r.key === 'feedback')?.value as
    | { windowDays?: number; minOrderCents?: number }
    | undefined;
  const reputation: ReputationSettings = {
    feedbackMinOrderCents:
      feedback?.minOrderCents ?? DEFAULT_REPUTATION_SETTINGS.feedbackMinOrderCents,
    feedbackWindowDays: feedback?.windowDays ?? DEFAULT_REPUTATION_SETTINGS.feedbackWindowDays,
  };
  const topSeller: TopSellerSettings = {
    ...DEFAULT_TOP_SELLER_SETTINGS,
    ...(rows.find((r) => r.key === 'topSeller')?.value as Partial<TopSellerSettings> | undefined),
  };
  return { reputation, topSeller };
}

/**
 * SPEC §8.4–8.7: rebuilds a user's `UserReputation` from the source rows (feedback, orders,
 * disputes, cancellations, conversations) and marks which feedback counts. Idempotent; called on
 * feedback/order events and nightly. Returns whether what search shows (percentage, badge) changed.
 */
export async function recomputeReputation(
  db: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<{ changed: boolean }> {
  const s = await settings(db);
  const since12m = new Date(now.getTime() - 365 * DAY);
  const since30d = new Date(now.getTime() - 30 * DAY);
  const [user, previous, received, pairOrders] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        createdAt: true,
        status: true,
        paymentAccount: { select: { transfersEnabled: true } },
      },
    }),
    db.userReputation.findUnique({ where: { userId } }),
    db.feedback.findMany({
      where: { recipientId: userId },
      include: { order: { select: { itemPriceCents: true } } },
    }),
    db.order.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: since30d },
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      select: { buyerId: true, sellerId: true, completedAt: true },
    }),
  ]);

  // Feedback between pairs trading suspiciously often doesn't count (SPEC §8.8).
  const suspicious = suspiciousPairs(
    pairOrders.map((o) => ({ ...o, completedAt: o.completedAt as Date })),
    now,
  );
  const records: FeedbackRecord[] = received.map((f) => ({
    id: f.id,
    authorId: f.authorId,
    recipientId: f.recipientId,
    role: f.role,
    rating: f.rating,
    status: suspicious.has([f.authorId, f.recipientId].sort().join('|')) ? 'HIDDEN' : f.status,
    orderItemPriceCents: f.order.itemPriceCents,
    weekKey: f.weekKey,
    createdAt: f.createdAt,
    dsrItemAsDescribed: f.dsrItemAsDescribed,
    dsrCommunication: f.dsrCommunication,
    dsrShippingTime: f.dsrShippingTime,
    dsrPackaging: f.dsrPackaging,
  }));
  const rep = computeReputation(records, now, s.reputation);

  const [sales, sales12m, purchases, disputesLost, cancellations, conversations] =
    await Promise.all([
      db.order.count({ where: { sellerId: userId, status: 'COMPLETED' } }),
      db.order.aggregate({
        where: { sellerId: userId, status: 'COMPLETED', completedAt: { gte: since12m } },
        _count: true,
        _sum: { itemPriceCents: true },
      }),
      db.order.count({ where: { buyerId: userId, status: 'COMPLETED' } }),
      db.dispute.count({
        where: {
          order: { sellerId: userId },
          sellerAtFault: true,
          resolvedById: { not: null },
          outcome: { not: 'RELEASE_TO_SELLER' },
          resolvedAt: { gte: since12m },
        },
      }),
      db.orderEvent.count({
        where: {
          order: { sellerId: userId },
          event: { in: ['SELLER_CANCELLED', 'SHIP_DEADLINE_EXPIRED'] },
          createdAt: { gte: since12m },
        },
      }),
      db.conversation.findMany({
        where: { sellerId: userId, createdAt: { gte: since30d } },
        select: {
          buyerId: true,
          messages: {
            where: { senderId: { not: null } },
            orderBy: { createdAt: 'asc' },
            take: 20,
            select: { senderId: true, createdAt: true },
          },
        },
      }),
    ]);
  const response = responseMetrics(
    conversations.flatMap((c) => {
      const first = c.messages.find((m) => m.senderId === c.buyerId);
      if (!first) return [];
      const reply = c.messages.find((m) => m.senderId === userId && m.createdAt >= first.createdAt);
      return [{ firstBuyerAt: first.createdAt, firstReplyAt: reply?.createdAt ?? null }];
    }),
  );
  const isTopSeller =
    unmetTopSellerRequirements(
      {
        accountAgeDays: (now.getTime() - user.createdAt.getTime()) / DAY,
        transfersEnabled: !!user.paymentAccount?.transfersEnabled,
        completedSales12m: sales12m._count,
        salesVolume12mCents: sales12m._sum.itemPriceCents ?? 0,
        sellerPositivePctBps: rep.sellerPositivePctBps,
        dsr: rep.dsr,
        disputesLost12m: disputesLost,
        sellerCancellations12m: cancellations,
        hasActiveSanction: user.status !== 'ACTIVE',
      },
      s.topSeller,
    ).length === 0;

  const data = {
    score: rep.score,
    levelKey: rep.levelKey,
    sellerPositive12m: rep.sellerPositive12m,
    sellerNeutral12m: rep.sellerNeutral12m,
    sellerNegative12m: rep.sellerNegative12m,
    sellerPositivePctBps: rep.sellerPositivePctBps,
    buyerPositive12m: rep.buyerPositive12m,
    dsrItemAsDescribedAvg: rep.dsr.ItemAsDescribed.avg,
    dsrItemAsDescribedCount: rep.dsr.ItemAsDescribed.count,
    dsrCommunicationAvg: rep.dsr.Communication.avg,
    dsrCommunicationCount: rep.dsr.Communication.count,
    dsrShippingTimeAvg: rep.dsr.ShippingTime.avg,
    dsrShippingTimeCount: rep.dsr.ShippingTime.count,
    dsrPackagingAvg: rep.dsr.Packaging.avg,
    dsrPackagingCount: rep.dsr.Packaging.count,
    completedSales: sales,
    completedPurchases: purchases,
    salesVolume12mCents: BigInt(sales12m._sum.itemPriceCents ?? 0),
    disputesLost12m: disputesLost,
    sellerCancellations12m: cancellations,
    medianResponseMinutes: response.medianMinutes,
    responseRateBps: response.responseRateBps,
    isTopSeller,
    topSellerSince: isTopSeller ? (previous?.isTopSeller ? previous.topSellerSince : now) : null,
  };
  const countable = countableFeedbackIds(records, s.reputation);
  // Sequential statements: one connection, no concurrent queries on the transaction client.
  await db.$transaction(async (tx) => {
    await tx.userReputation.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    await tx.feedback.updateMany({
      where: { recipientId: userId, id: { in: [...countable] } },
      data: { countsTowardScore: true },
    });
    await tx.feedback.updateMany({
      where: { recipientId: userId, id: { notIn: [...countable] } },
      data: { countsTowardScore: false },
    });
  });
  return {
    changed:
      previous?.sellerPositivePctBps !== data.sellerPositivePctBps ||
      previous?.isTopSeller !== data.isTopSeller ||
      previous?.levelKey !== data.levelKey,
  };
}
