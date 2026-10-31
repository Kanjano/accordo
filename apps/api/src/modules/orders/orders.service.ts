import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@accordo/db';
import {
  computeOrderAmounts,
  DisputeActionError,
  deriveHandoverCode,
  generateOrderNumber,
  handoverCodeMatches,
  type OrderEvent,
  OrderTransitionError,
  registerHandoverAttempt,
  transition,
} from '@accordo/domain';
import {
  type Actor,
  applyOrderEvent,
  loadOrderSettings,
  OrderConflictError,
  runDueAction,
} from '@accordo/orders';
import type { PaymentProvider } from '@accordo/payments';
import type {
  CheckoutResponse,
  OrderAction,
  OrderCreate,
  OrderDetail,
  OrderStatusCode,
  OrderSummary,
} from '@accordo/shared';
import type { ShippingProvider, TrackingProvider } from '@accordo/shipping';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PAYMENTS, PRISMA, SHIPPING, TRACKING } from '../platform/infra.providers.js';
import { SettingsService } from '../platform/settings.service.js';

const DAY = 86_400_000;
const ACTIVE = [
  'CHECKOUT_PENDING',
  'PAID',
  'HANDOVER_PENDING',
  'SHIPPED',
  'DELIVERED',
  'DISPUTED',
  'RETURN_IN_TRANSIT',
] as const;

const orderInclude = {
  buyer: { select: { id: true, username: true, name: true } },
  seller: { select: { id: true, username: true, name: true } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Domain errors → Problem Details (409 for guards and invalid transitions). */
function rethrow(e: unknown): never {
  if (e instanceof OrderTransitionError)
    throw new ConflictException({
      code: e.code === 'GUARD_FAILED' ? 'ORDER_NOT_ALLOWED' : 'INVALID_TRANSITION',
      detail: e.message,
    });
  if (e instanceof OrderConflictError) throw new ConflictException({ code: 'ORDER_CHANGED' });
  if (e instanceof DisputeActionError) throw new ConflictException({ code: e.code });
  throw e;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(PAYMENTS) private readonly payments: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    @Inject(SHIPPING) private readonly shipping: ShippingProvider,
    @Inject(TRACKING) private readonly tracking: TrackingProvider,
    private readonly settings: SettingsService,
  ) {}

  /** OrdersService.transition() of the SPEC: every status change of an existing order goes here. */
  async transition(
    orderId: string,
    event: OrderEvent,
    actor: Actor,
    reason?: string,
    /** Extra writes in the same transaction (e.g. the shipment the event refers to). */
    alsoInTx?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const r = await applyOrderEvent(tx, orderId, event, actor, {
          handoverPepper: this.env.HANDOVER_CODE_PEPPER,
          reason,
        });
        await alsoInTx?.(tx);
        return r;
      });
    } catch (e) {
      rethrow(e);
    }
  }

  // ───────────── Checkout ─────────────

  async checkout(userId: string, input: OrderCreate): Promise<CheckoutResponse> {
    const buyer = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerified: true, createdAt: true, status: true },
    });
    if (buyer.status !== 'ACTIVE') throw new ForbiddenException({ code: 'ACCOUNT_LIMITED' });
    // SPEC §6.11: accounts younger than 7 days, at most 3 orders in 24 hours.
    if (Date.now() - buyer.createdAt.getTime() < 7 * DAY) {
      const recent = await this.db.order.count({
        where: { buyerId: userId, createdAt: { gte: new Date(Date.now() - DAY) } },
      });
      if (recent >= 3)
        throw new HttpException({ code: 'ORDER_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const listing = await this.db.listing.findFirst({
      where: { id: input.listingId, deletedAt: null },
      include: {
        seller: { select: { paymentAccount: true } },
        images: { where: { width: { gt: 0 } }, orderBy: { position: 'asc' }, take: 1 },
      },
    });
    if (!listing) throw new NotFoundException();

    let priceCents = listing.priceCents;
    let offerOk = false;
    if (input.offerId) {
      const offer = await this.db.offer.findFirst({
        where: {
          id: input.offerId,
          buyerId: userId,
          listingId: listing.id,
          status: 'ACCEPTED',
          expiresAt: { gt: new Date() },
        },
      });
      if (!offer) throw new ConflictException({ code: 'OFFER_NOT_PAYABLE' });
      priceCents = offer.amountCents;
      offerOk = true;
    }
    if (listing.status === 'RESERVED' && !offerOk)
      throw new ConflictException({ code: 'LISTING_NOT_AVAILABLE' });

    const method = input.deliveryMethod;
    const integrated = method === 'SHIPPING_INTEGRATED';
    // Integrated shipping needs a parcel size and the seller's sender address (SPEC §7.3).
    const sender = integrated
      ? await this.db.address.findFirst({
          where: { userId: listing.sellerId, type: 'SENDER' },
          select: { id: true },
        })
      : null;
    const allowed =
      (integrated && listing.shippingIntegrated && !!listing.parcelSize && !!sender) ||
      (method === 'SHIPPING_SELF' && listing.shippingSelf && !!listing.selfShippingPriceCents) ||
      (method === 'HAND_DELIVERY' && listing.handDeliveryEnabled);
    if (!allowed) throw new ConflictException({ code: 'DELIVERY_NOT_AVAILABLE' });
    let shippingAddress: Prisma.InputJsonValue | undefined;
    let servicePoint: Prisma.InputJsonValue | undefined;
    if (method !== 'HAND_DELIVERY') {
      const address = await this.db.address.findFirst({
        where: { id: input.addressId, userId, type: 'SHIPPING' },
        include: { comune: { include: { provincia: true } } },
      });
      if (!input.addressId || !address)
        throw new UnprocessableEntityException({ code: 'ADDRESS_REQUIRED' });
      shippingAddress = {
        fullName: address.fullName,
        line1: address.line1,
        line2: address.line2,
        cap: address.cap,
        comune: address.comune.name,
        provincia: address.comune.provincia.sigla,
        phone: address.phone,
        country: 'IT',
      };
    }
    if (integrated && input.servicePointId) {
      // Snapshot of a point the provider really offers near the chosen CAP.
      const points = await this.shipping.listServicePoints({
        cap: input.servicePointCap ?? (shippingAddress as { cap: string }).cap,
      });
      const point = points.find((p) => p.id === input.servicePointId);
      if (!point) throw new UnprocessableEntityException({ code: 'SERVICE_POINT_NOT_FOUND' });
      servicePoint = { ...point };
    }

    const { fees, timings, holidays } = await loadOrderSettings(this.db);
    const parcelSizes = await this.settings.get('parcelSizes');
    const amounts = computeOrderAmounts(
      {
        itemPriceCents: priceCents,
        deliveryMethod: method,
        selfShippingPriceCents: listing.selfShippingPriceCents,
        integratedShippingCents: listing.parcelSize
          ? parcelSizes[listing.parcelSize].priceCents
          : null,
      },
      fees,
    );
    const activeOrders = await this.db.order.count({
      where: { listingId: listing.id, status: { in: [...ACTIVE] } },
    });
    let start: ReturnType<typeof transition>;
    try {
      start = transition(
        {
          status: null,
          deliveryMethod: method,
          currency: 'EUR',
          itemPriceCents: amounts.itemPriceCents,
          totalCents: amounts.totalCents,
          sellerNetCents: amounts.sellerNetCents,
        },
        {
          type: 'CHECKOUT_STARTED',
          guards: {
            listingActiveWithProtectedPayment:
              (listing.status === 'ACTIVE' || offerOk) &&
              listing.protectedPaymentEnabled &&
              !!listing.seller.paymentAccount?.transfersEnabled,
            buyerIsSeller: listing.sellerId === userId,
            buyerEmailVerified: buyer.emailVerified,
            listingHasActiveOrder: activeOrders > 0,
          },
        },
        { now: new Date(), holidays, timings },
      );
    } catch (e) {
      rethrow(e);
    }

    let order: { id: string; transferGroup: string };
    try {
      order = await this.db.$transaction(async (tx) => {
        const number = generateOrderNumber();
        const created = await tx.order.create({
          data: {
            number,
            transferGroup: `order_${number}`,
            listingId: listing.id,
            buyerId: userId,
            sellerId: listing.sellerId,
            offerId: input.offerId ?? null,
            status: 'CHECKOUT_PENDING',
            deliveryMethod: method,
            listingSnapshot: {
              id: listing.id,
              title: listing.title,
              slug: listing.slug,
              shortId: listing.shortId,
              condition: listing.condition,
              imageKey: listing.images[0]?.storageKey ?? null,
            },
            ...amounts,
            shippingAddress,
            servicePoint,
            reservedUntil: start.patch.reservedUntil ?? null,
            nextAction: start.timer?.action ?? null,
            nextActionAt: start.timer?.at ?? null,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: created.id,
            fromStatus: null,
            toStatus: 'CHECKOUT_PENDING',
            event: 'CHECKOUT_STARTED',
            actorRole: 'BUYER',
            actorId: userId,
          },
        });
        return created;
      });
    } catch (e) {
      // "Order_one_active_per_listing": a concurrent checkout won (SPEC §6.12).
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException({ code: 'LISTING_NOT_AVAILABLE' });
      throw e;
    }

    try {
      const pi = await this.payments.createPaymentIntent({
        amountCents: amounts.totalCents,
        currency: 'EUR',
        transferGroup: order.transferGroup,
        orderId: order.id,
        idempotencyKey: `pi:${order.id}`,
      });
      await this.db.order.update({ where: { id: order.id }, data: { paymentIntentId: pi.id } });
      return {
        orderId: order.id,
        provider: this.payments.name,
        clientSecret: pi.clientSecret,
        amounts: { ...amounts, refundedCents: 0 },
      };
    } catch (e) {
      await this.transition(order.id, { type: 'PAYMENT_FAILED' }, { role: 'SYSTEM', id: null });
      throw e;
    }
  }

  /** The buyer reopening the checkout page gets the same PaymentIntent (idempotent). */
  async paymentSecret(userId: string, orderId: string) {
    const o = await this.party(userId, orderId);
    if (o.buyerId !== userId || o.status !== 'CHECKOUT_PENDING')
      throw new ConflictException({ code: 'ORDER_NOT_PAYABLE' });
    const pi = await this.payments.createPaymentIntent({
      amountCents: o.totalCents,
      currency: o.currency,
      transferGroup: o.transferGroup,
      orderId: o.id,
      idempotencyKey: `pi:${o.id}`,
    });
    return {
      provider: this.payments.name,
      clientSecret: pi.clientSecret,
      reservedUntil: o.reservedUntil?.toISOString() ?? null,
    };
  }

  // ───────────── Reads ─────────────

  /** Party check with a uniform 404 (staff see every order). */
  async party(userId: string, id: string, staff = false): Promise<OrderRow> {
    const o = await this.db.order.findFirst({
      where: { id, ...(staff ? {} : { OR: [{ buyerId: userId }, { sellerId: userId }] }) },
      include: orderInclude,
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  private summary(o: OrderRow, userId: string): OrderSummary {
    const isBuyer = o.buyerId === userId;
    return {
      id: o.id,
      number: o.number,
      status: o.status as OrderStatusCode,
      role: isBuyer ? 'BUYER' : 'SELLER',
      deliveryMethod: o.deliveryMethod,
      listing: o.listingSnapshot as unknown as OrderSummary['listing'],
      totalCents: o.totalCents,
      sellerNetCents: o.sellerNetCents,
      counterpart: isBuyer ? o.seller : o.buyer,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  async list(userId: string, role: 'buyer' | 'seller', status?: string): Promise<OrderSummary[]> {
    const rows = await this.db.order.findMany({
      where: {
        ...(role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
        ...(status ? { status: status as OrderStatusCode } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((o) => this.summary(o, userId));
  }

  async adminList(status?: string, q?: string) {
    const rows = await this.db.order.findMany({
      where: {
        ...(status ? { status: status as OrderStatusCode } : {}),
        ...(q ? { number: { contains: q.trim().toUpperCase() } } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((o) => ({
      ...this.summary(o, o.buyerId),
      buyer: o.buyer,
      seller: o.seller,
      payoutStatus: o.payoutStatus,
    }));
  }

  async detail(userId: string, id: string, staff = false): Promise<OrderDetail> {
    const o = await this.party(userId, id, staff);
    const [events, shipments, dispute] = await Promise.all([
      this.db.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } }),
      this.db.shipment.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } }),
      this.db.dispute.findUnique({ where: { orderId: id }, select: { id: true, status: true } }),
    ]);
    const isBuyer = o.buyerId === userId;
    const cancelRequest = this.pendingCancelRequest(events);
    const actions: OrderAction[] = [];
    const s = o.status;
    if (isBuyer) {
      if (s === 'CHECKOUT_PENDING') actions.push('pay');
      if (s === 'HANDOVER_PENDING') actions.push('showHandoverCode');
      if (s === 'SHIPPED' || s === 'DELIVERED') actions.push('confirmReceipt');
      // Timing rules (not received only after the expected delivery) are checked on submit.
      if ((s === 'SHIPPED' || s === 'DELIVERED') && !dispute) actions.push('openDispute');
    } else if (o.sellerId === userId) {
      if (s === 'PAID' && o.deliveryMethod === 'SHIPPING_SELF') actions.push('ship');
      if (s === 'PAID') actions.push('cancel');
      if (s === 'HANDOVER_PENDING') actions.push('verifyHandover');
    }
    if ((s === 'PAID' || s === 'HANDOVER_PENDING') && !staff) {
      if (!cancelRequest) actions.push('requestCancel');
      else if (cancelRequest.actorId !== userId) actions.push('acceptCancel');
    }
    // The seller sees the shipping address only once paid.
    const showAddress =
      isBuyer || staff || !['CHECKOUT_PENDING', 'PAYMENT_FAILED', 'EXPIRED'].includes(s);
    return {
      ...this.summary(o, userId),
      amounts: {
        itemPriceCents: o.itemPriceCents,
        shippingPriceCents: o.shippingPriceCents,
        buyerFeeCents: o.buyerFeeCents,
        buyerFeeVatCents: o.buyerFeeVatCents,
        totalCents: o.totalCents,
        sellerNetCents: o.sellerNetCents,
        refundedCents: o.refundedCents,
      },
      payoutStatus: o.payoutStatus,
      shippingAddress: showAddress ? (o.shippingAddress as OrderDetail['shippingAddress']) : null,
      servicePoint: o.servicePoint as OrderDetail['servicePoint'],
      shipments: shipments.map((sh) => ({
        id: sh.id,
        direction: sh.direction,
        labelAvailable: !!sh.labelKey,
        providerMock: sh.provider === 'mock',
        trackingUrl: sh.trackingUrl,
        events:
          (sh.events as Array<{ status: string; occurredAt: string; description?: string }>) ?? [],
        carrier: sh.carrier,
        trackingNumber: sh.trackingNumber,
        status: sh.status,
        shippedAt: sh.shippedAt?.toISOString() ?? null,
      })),
      deadlines: {
        reservedUntil: o.reservedUntil?.toISOString() ?? null,
        shipBy: o.shipBy?.toISOString() ?? null,
        autoCompleteAt: o.autoCompleteAt?.toISOString() ?? null,
        nextActionAt: o.nextActionAt?.toISOString() ?? null,
      },
      timeline: events.map((e) => ({
        event: e.event,
        toStatus: e.toStatus,
        actorRole: e.actorRole,
        at: e.createdAt.toISOString(),
      })),
      actions,
      cancelRequest: cancelRequest
        ? { byMe: cancelRequest.actorId === userId, at: cancelRequest.createdAt.toISOString() }
        : null,
      handoverLockedTill: o.handoverLockedTill?.toISOString() ?? null,
      dispute,
    };
  }

  /** A CANCEL_REQUESTED event not followed by a status change. */
  private pendingCancelRequest(
    events: Array<{
      event: string;
      actorId: string | null;
      createdAt: Date;
      fromStatus: string | null;
      toStatus: string;
    }>,
  ) {
    const last = events.at(-1);
    return last?.event === 'CANCEL_REQUESTED' ? last : null;
  }

  /** Development only: runs the order's pending timer now, like the sweeper would (J8). */
  async runTimerNow(id: string) {
    const order = await this.db.order.findUniqueOrThrow({ where: { id } });
    if (!order.nextAction) throw new ConflictException({ code: 'NO_TIMER' });
    try {
      const ran = await this.db.$transaction((tx) =>
        runDueAction(tx, order, new Date(), this.env.HANDOVER_CODE_PEPPER),
      );
      return { action: order.nextAction, ran };
    } catch (e) {
      rethrow(e);
    }
  }

  /** Staff refund on a completed order: a REFUND effect for the worker (no state change). */
  async adminRefund(staffId: string, id: string, amountCents: number, reason: string) {
    const o = await this.db.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== 'COMPLETED') throw new ConflictException({ code: 'ORDER_NOT_COMPLETED' });
    if (amountCents > o.sellerNetCents - o.refundedCents)
      throw new UnprocessableEntityException({ code: 'REFUND_OUT_OF_RANGE' });
    const eventId = `admin-refund:${randomUUID()}`;
    await this.db.$transaction([
      this.db.outboxEvent.create({
        data: {
          aggregateType: 'Order',
          aggregateId: id,
          type: 'order.effects',
          payload: {
            orderId: id,
            eventId,
            effects: [{ type: 'REFUND', amountCents, includesBuyerFee: false }],
          },
        },
      }),
      this.db.auditLog.create({
        data: {
          actorId: staffId,
          action: 'order.refund',
          entityType: 'Order',
          entityId: id,
          metadata: { amountCents, reason, eventId },
        },
      }),
    ]);
    return { queued: true, eventId };
  }

  // ───────────── Actions ─────────────

  private async asSeller(userId: string, id: string) {
    const o = await this.party(userId, id);
    if (o.sellerId !== userId) throw new ForbiddenException({ code: 'SELLER_ONLY' });
    return o;
  }

  private async asBuyer(userId: string, id: string) {
    const o = await this.party(userId, id);
    if (o.buyerId !== userId) throw new ForbiddenException({ code: 'BUYER_ONLY' });
    return o;
  }

  async ship(userId: string, id: string, carrier: string, trackingNumber: string) {
    const o = await this.asSeller(userId, id);
    if (o.deliveryMethod !== 'SHIPPING_SELF')
      throw new ConflictException({ code: 'DELIVERY_NOT_SELF' });
    await this.transition(
      o.id,
      { type: 'SHIPMENT_CONFIRMED', carrier, trackingNumber },
      { role: 'SELLER', id: userId },
      undefined,
      // Same transaction: the worker's REGISTER_TRACKING finds it.
      (tx) =>
        tx.shipment.create({
          data: {
            orderId: o.id,
            provider: this.tracking.name,
            providerShipmentId: `track_${randomUUID()}`,
            carrier,
            trackingNumber,
            status: 'IN_TRANSIT',
            shippedAt: new Date(),
          },
        }),
    );
    return this.detail(userId, id);
  }

  /** The label PDF (private bucket), for the seller (or the buyer for a return label). */
  async label(userId: string, id: string, shipmentId?: string) {
    const o = await this.party(userId, id);
    const shipment = await this.db.shipment.findFirst({
      where: {
        orderId: o.id,
        labelKey: { not: null },
        ...(shipmentId ? { id: shipmentId } : {}),
        direction: o.sellerId === userId ? 'OUTBOUND' : 'RETURN',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment?.labelKey) throw new NotFoundException();
    return { key: shipment.labelKey, filename: `etichetta-${o.number}.pdf` };
  }

  servicePoints(cap: string) {
    return this.shipping.listServicePoints({ cap });
  }

  /** Step-up enforced by the controller (SPEC §6.11). */
  async confirmReceipt(userId: string, id: string) {
    const o = await this.asBuyer(userId, id);
    if (o.status === 'COMPLETED') return this.detail(userId, id); // idempotent
    await this.transition(
      o.id,
      { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: true },
      { role: 'BUYER', id: userId },
    );
    return this.detail(userId, id);
  }

  async handoverCode(userId: string, id: string) {
    const o = await this.asBuyer(userId, id);
    if (o.status !== 'HANDOVER_PENDING')
      throw new ConflictException({ code: 'HANDOVER_NOT_PENDING' });
    return {
      code: deriveHandoverCode(o.id, this.env.HANDOVER_CODE_PEPPER),
      expiresAt: o.nextActionAt?.toISOString() ?? null,
    };
  }

  async verifyHandover(userId: string, id: string, code: string) {
    const o = await this.asSeller(userId, id);
    if (o.status !== 'HANDOVER_PENDING' || !o.handoverCodeHash)
      throw new ConflictException({ code: 'HANDOVER_NOT_PENDING' });
    const matched = handoverCodeMatches(
      code,
      o.id,
      this.env.HANDOVER_CODE_PEPPER,
      o.handoverCodeHash,
    );
    const attempt = registerHandoverAttempt(
      { attempts: o.handoverAttempts, lockedTill: o.handoverLockedTill },
      matched,
      new Date(),
    );
    await this.db.order.update({
      where: { id: o.id },
      data: {
        handoverAttempts: attempt.state.attempts,
        handoverLockedTill: attempt.state.lockedTill,
      },
    });
    if (attempt.outcome === 'LOCKED')
      throw new HttpException(
        { code: 'HANDOVER_LOCKED', detail: attempt.lockedTill.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (attempt.outcome === 'WRONG_CODE')
      throw new UnprocessableEntityException({
        code: 'HANDOVER_WRONG_CODE',
        detail: String(attempt.attemptsLeft),
      });
    await this.transition(o.id, { type: 'HANDOVER_CODE_VERIFIED' }, { role: 'SELLER', id: userId });
    return this.detail(userId, id);
  }

  async cancel(userId: string, id: string, reason?: string) {
    const o = await this.asSeller(userId, id);
    await this.transition(
      o.id,
      { type: 'SELLER_CANCELLED' },
      { role: 'SELLER', id: userId },
      reason,
    );
    return this.detail(userId, id);
  }

  async requestCancel(userId: string, id: string, reason?: string) {
    const o = await this.party(userId, id);
    if (o.status !== 'PAID' && o.status !== 'HANDOVER_PENDING')
      throw new ConflictException({ code: 'ORDER_NOT_CANCELLABLE' });
    await this.db.orderEvent.create({
      data: {
        orderId: o.id,
        fromStatus: o.status,
        toStatus: o.status,
        event: 'CANCEL_REQUESTED',
        actorRole: o.buyerId === userId ? 'BUYER' : 'SELLER',
        actorId: userId,
        reason: reason ?? null,
      },
    });
    await this.db.outboxEvent.create({
      data: {
        aggregateType: 'Order',
        aggregateId: o.id,
        type: 'order.effects',
        payload: {
          orderId: o.id,
          effects: [
            {
              type: 'NOTIFY',
              template: 'order.cancel_requested',
              to: [o.buyerId === userId ? 'SELLER' : 'BUYER'],
            },
          ],
        },
      },
    });
    return this.detail(userId, id);
  }

  async acceptCancel(userId: string, id: string) {
    const o = await this.party(userId, id);
    const last = await this.db.orderEvent.findFirst({
      where: { orderId: o.id },
      orderBy: { createdAt: 'desc' },
    });
    if (last?.event !== 'CANCEL_REQUESTED' || last.actorId === userId)
      throw new ConflictException({ code: 'NO_CANCEL_REQUEST' });
    await this.transition(
      o.id,
      { type: 'MUTUAL_CANCEL' },
      { role: o.buyerId === userId ? 'BUYER' : 'SELLER', id: userId },
    );
    return this.detail(userId, id);
  }
}
