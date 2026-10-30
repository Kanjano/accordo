import type { PrismaClient } from '@accordo/db';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import type { Emitter } from '@socket.io/redis-emitter';
import type { Queue } from 'bullmq';
import { PRISMA, REALTIME } from './infra.js';
import { QUEUES } from './queues.js';

@Injectable()
export class OffersScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.offers) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      'offers-every-minute',
      { every: 60_000 },
      { name: 'sweep' },
    );
  }
}

/**
 * Every minute (SPEC §3.6): pending offers past 48 h expire; accepted offers whose 24 h checkout
 * window passed without an order expire too and release the listing reservation.
 * Each change writes an OFFER message + `offer.expired` outbox event (notifications).
 */
@Processor(QUEUES.offers)
export class OffersProcessor extends WorkerHost {
  private readonly logger = new Logger(OffersProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Optional() @Inject(REALTIME) private readonly realtime?: Emitter,
  ) {
    super();
  }

  process() {
    return this.run(new Date());
  }

  async run(now: Date): Promise<{ expired: number; released: number }> {
    const due = await this.db.offer.findMany({
      where: {
        expiresAt: { lte: now },
        OR: [{ status: 'PENDING' }, { status: 'ACCEPTED', order: null }],
      },
      take: 500,
    });
    let expired = 0;
    let released = 0;
    for (const offer of due) {
      const done = await this.db.$transaction(async (tx) => {
        const { count } = await tx.offer.updateMany({
          where: {
            id: offer.id,
            status: offer.status,
            ...(offer.status === 'ACCEPTED' ? { order: null } : {}),
          },
          data: { status: 'EXPIRED' },
        });
        if (!count) return false; // answered or paid meanwhile
        let release = false;
        if (offer.status === 'ACCEPTED') {
          const r = await tx.listing.updateMany({
            where: { id: offer.listingId, status: 'RESERVED' },
            data: { status: 'ACTIVE' },
          });
          release = r.count > 0;
          if (release)
            await tx.outboxEvent.create({
              data: {
                aggregateType: 'Listing',
                aggregateId: offer.listingId,
                type: 'listing.released',
                payload: { listingId: offer.listingId, offerId: offer.id },
              },
            });
        }
        const conversation = await tx.conversation.findUnique({
          where: { listingId_buyerId: { listingId: offer.listingId, buyerId: offer.buyerId } },
          select: { id: true },
        });
        if (conversation) {
          await tx.message.create({
            data: {
              conversationId: conversation.id,
              type: 'OFFER',
              body: 'expired',
              offerId: offer.id,
            },
          });
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: now },
          });
          // Both parties hear about it: the proposer (or buyer) and the counterpart.
          await tx.outboxEvent.createMany({
            data: [offer.buyerId, offer.sellerId].map((recipientId) => ({
              aggregateType: 'Offer',
              aggregateId: offer.id,
              type: 'offer.expired',
              payload: { offerId: offer.id, conversationId: conversation.id, recipientId },
            })),
          });
        }
        return { release, conversationId: conversation?.id ?? null };
      });
      if (!done) continue;
      expired++;
      if (done.release) released++;
      this.realtime?.to([`user:${offer.buyerId}`, `user:${offer.sellerId}`]).emit('offer:updated', {
        conversationId: done.conversationId,
        offer: {
          ...offer,
          status: 'EXPIRED',
          expiresAt: offer.expiresAt.toISOString(),
          createdAt: offer.createdAt.toISOString(),
        },
      });
    }
    if (expired) this.logger.log(`offers: ${expired} expired, ${released} reservations released`);
    return { expired, released };
  }
}
