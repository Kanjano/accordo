import type { Prisma, PrismaClient } from '@accordo/db';
import {
  counterProposer,
  type OfferAction,
  offerActionError,
  offerAmountError,
} from '@accordo/domain';
import type { MyOfferItem, OfferEvent, OfferItem } from '@accordo/shared';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { listingSelect, toListing, toMessage, toOffer } from './mappers.js';
import { MessagingService } from './messaging.service.js';

const HOUR = 3_600_000;

/** SPEC §3.6: offers on negotiable listings with protected payment, answered in the conversation. */
@Injectable()
export class OffersService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
    private readonly messaging: MessagingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(
    userId: string,
    listingId: string,
    amountCents: number,
  ): Promise<OfferItem & { conversationId: string }> {
    const listing = await this.db.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        status: true,
        priceCents: true,
        isNegotiable: true,
        protectedPaymentEnabled: true,
      },
    });
    if (!listing || !['ACTIVE', 'RESERVED'].includes(listing.status)) throw new NotFoundException();
    if (listing.sellerId === userId) throw new ConflictException({ code: 'OWN_LISTING' });
    if (!listing.isNegotiable || !listing.protectedPaymentEnabled)
      throw new ConflictException({ code: 'OFFERS_NOT_ALLOWED' });
    if (listing.status !== 'ACTIVE') throw new ConflictException({ code: 'LISTING_NOT_AVAILABLE' });
    await this.messaging.assertCanInitiate(userId, listing.sellerId);

    const s = await this.settings.get('offers');
    const amountError = offerAmountError(amountCents, listing.priceCents, s.minPercent);
    if (amountError) throw new UnprocessableEntityException({ code: amountError });
    const active = await this.db.offer.count({
      where: { listingId, buyerId: userId, status: 'PENDING' },
    });
    if (active >= s.maxActivePerBuyerAndListing)
      throw new ConflictException({ code: 'TOO_MANY_OFFERS' });
    await this.rateLimit.consume(`offer:${userId}`, 20, 24 * 3600);

    const after: Array<() => void> = [];
    const offer = await this.db.$transaction(async (tx) => {
      const conversation = await this.messaging.ensureConversation(tx, listing, userId);
      const o = await tx.offer.create({
        data: {
          listingId,
          buyerId: userId,
          sellerId: listing.sellerId,
          proposedById: userId,
          amountCents,
          expiresAt: new Date(Date.now() + s.expiryHours * HOUR),
        },
      });
      await this.record(tx, conversation.id, o, 'created', listing.sellerId, after);
      return { ...toOffer(o), conversationId: conversation.id };
    });
    for (const emit of after) emit();
    return offer;
  }

  async act(
    userId: string,
    offerId: string,
    action: OfferAction,
    amountCents?: number,
  ): Promise<OfferItem> {
    const offer = await this.db.offer.findFirst({
      where: { id: offerId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: { listing: { select: { priceCents: true, status: true } } },
    });
    if (!offer) throw new NotFoundException();
    const error = offerActionError(offer, userId, action, new Date());
    if (error === 'NOT_PARTY') throw new NotFoundException();
    if (error === 'NOT_PROPOSER' || error === 'NOT_RECIPIENT')
      throw new ForbiddenException({ code: error });
    if (error) throw new ConflictException({ code: error });
    const s = await this.settings.get('offers');
    if (action === 'counter') {
      const amountError = offerAmountError(
        amountCents ?? 0,
        offer.listing.priceCents,
        s.minPercent,
      );
      if (amountError) throw new UnprocessableEntityException({ code: amountError });
    }
    const counterpart = userId === offer.buyerId ? offer.sellerId : offer.buyerId;
    const now = new Date();
    const after: Array<() => void> = [];

    const result = await this.db.$transaction(async (tx) => {
      const status = {
        accept: 'ACCEPTED',
        decline: 'DECLINED',
        counter: 'COUNTERED',
        withdraw: 'WITHDRAWN',
      } as const;
      // Guarded update: a concurrent answer or the expiry sweeper wins only once.
      const { count } = await tx.offer.updateMany({
        where: { id: offer.id, status: 'PENDING' },
        data: {
          status: status[action],
          respondedAt: now,
          // Accepted: the expiry becomes the checkout deadline (listing reserved until then).
          ...(action === 'accept'
            ? { expiresAt: new Date(now.getTime() + s.acceptedCheckoutHours * HOUR) }
            : {}),
        },
      });
      if (!count) throw new ConflictException({ code: 'OFFER_NOT_PENDING' });
      if (action === 'accept') {
        const reserved = await tx.listing.updateMany({
          where: { id: offer.listingId, status: 'ACTIVE' },
          data: { status: 'RESERVED' },
        });
        if (!reserved.count) throw new ConflictException({ code: 'LISTING_NOT_AVAILABLE' });
        await writeOutbox(tx, {
          aggregateType: 'Listing',
          aggregateId: offer.listingId,
          type: 'listing.reserved',
          payload: { listingId: offer.listingId, offerId: offer.id },
        });
      }
      const conversation = await this.messaging.ensureConversation(
        tx,
        { id: offer.listingId, sellerId: offer.sellerId },
        offer.buyerId,
      );
      const updated = await tx.offer.findUniqueOrThrow({ where: { id: offer.id } });
      if (action !== 'counter') {
        const event = ({ accept: 'accepted', decline: 'declined', withdraw: 'withdrawn' } as const)[
          action
        ];
        await this.record(tx, conversation.id, updated, event, counterpart, after);
        return updated;
      }
      const counter = await tx.offer.create({
        data: {
          listingId: offer.listingId,
          buyerId: offer.buyerId,
          sellerId: offer.sellerId,
          proposedById: counterProposer(offer),
          parentOfferId: offer.id,
          amountCents: amountCents as number,
          expiresAt: new Date(now.getTime() + s.expiryHours * HOUR),
        },
      });
      after.push(() =>
        this.realtime.emit([offer.buyerId, offer.sellerId], 'offer:updated', {
          conversationId: conversation.id,
          offer: toOffer(updated),
        }),
      );
      await this.record(tx, conversation.id, counter, 'countered', counterpart, after);
      return counter;
    });
    for (const emit of after) emit();
    return toOffer(result);
  }

  /** Offer message in the conversation + outbox event (notification); realtime queued for after commit. */
  private async record(
    tx: Prisma.TransactionClient,
    conversationId: string,
    offer: Prisma.OfferGetPayload<object>,
    event: OfferEvent,
    recipientId: string,
    after: Array<() => void>,
  ) {
    const m = await tx.message.create({
      data: { conversationId, senderId: null, type: 'OFFER', body: event, offerId: offer.id },
      include: { offer: true },
    });
    const recipientIsBuyer = recipientId === offer.buyerId;
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: m.createdAt,
        ...(recipientIsBuyer
          ? { buyerUnread: { increment: 1 }, buyerArchivedAt: null }
          : { sellerUnread: { increment: 1 }, sellerArchivedAt: null }),
      },
    });
    await writeOutbox(tx, {
      aggregateType: 'Offer',
      aggregateId: offer.id,
      type: `offer.${event}`,
      payload: { offerId: offer.id, conversationId, recipientId },
    });
    const parties = [offer.buyerId, offer.sellerId];
    after.push(() => {
      this.realtime.emit(parties, 'message:new', { conversationId, message: toMessage(m) });
      this.realtime.emit(parties, 'offer:updated', { conversationId, offer: toOffer(offer) });
    });
  }

  async mine(userId: string, role: 'buyer' | 'seller'): Promise<MyOfferItem[]> {
    const rows = await this.db.offer.findMany({
      where: role === 'buyer' ? { buyerId: userId } : { sellerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { listing: { select: listingSelect } },
    });
    const conversations = await this.db.conversation.findMany({
      where: {
        OR: rows.map((o) => ({ listingId: o.listingId, buyerId: o.buyerId })),
      },
      select: { id: true, listingId: true, buyerId: true },
    });
    return rows.map((o) => ({
      ...toOffer(o),
      listing: toListing(o.listing),
      conversationId:
        conversations.find((c) => c.listingId === o.listingId && c.buyerId === o.buyerId)?.id ??
        null,
    }));
  }
}
