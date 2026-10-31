import type { Prisma, PrismaClient } from '@accordo/db';
import {
  DEFAULT_ORDER_TIMINGS,
  type DeliveryMethod,
  deriveHandoverCode,
  type FeeSettings,
  hashHandoverCode,
  holidaySet,
  type LedgerTransactionDraft,
  type OrderEffect,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
  type OrderTimings,
  paymentSucceededEntries,
  type TransitionResult,
  transition,
} from '@accordo/domain';

type Db = PrismaClient | Prisma.TransactionClient;
type OrderRow = Prisma.OrderGetPayload<object>;

export interface Actor {
  role: 'BUYER' | 'SELLER' | 'SUPPORT' | 'SYSTEM';
  id: string | null;
}

/** Another transition won the optimistic lock (`Order.version`): reload and retry or give up. */
export class OrderConflictError extends Error {}

/** Effects executed by the worker (`payments` queue) after commit; the rest run in the transaction. */
export const ASYNC_EFFECTS = new Set<OrderEffect['type']>([
  'CANCEL_PAYMENT_INTENT',
  'TRANSFER_TO_SELLER',
  'REFUND',
  'NOTIFY',
  'CREATE_SHIPPING_LABEL',
  'REGISTER_TRACKING',
  'CREATE_RETURN_LABEL',
  'OPEN_FEEDBACK',
]);

export function snapshot(o: OrderRow, estimatedDeliveryAt?: Date | null): OrderSnapshot {
  return {
    status: o.status as OrderStatus,
    deliveryMethod: o.deliveryMethod as DeliveryMethod,
    currency: o.currency,
    itemPriceCents: o.itemPriceCents,
    totalCents: o.totalCents,
    sellerNetCents: o.sellerNetCents,
    shipBy: o.shipBy,
    shippedAt: o.shippedAt,
    estimatedDeliveryAt: estimatedDeliveryAt ?? null,
    deliveredAt: o.deliveredAt,
    autoCompleteAt: o.autoCompleteAt,
  };
}

/** Amounts snapshotted on the order, as the ledger builders want them. */
export function paymentInputOf(o: OrderRow) {
  return {
    totalCents: o.totalCents,
    sellerNetCents: o.sellerNetCents,
    shippingPriceCents: o.shippingPriceCents,
    buyerFeeCents: o.buyerFeeCents,
    buyerFeeVatCents: o.buyerFeeVatCents,
    sellerFeeCents: o.sellerFeeCents,
    deliveryMethod: o.deliveryMethod as DeliveryMethod,
    sellerId: o.sellerId,
  };
}

export async function loadOrderSettings(db: Db): Promise<{
  timings: OrderTimings;
  fees: FeeSettings;
  holidays: Set<string>;
}> {
  const [rows, holidays] = await Promise.all([
    db.platformSetting.findMany({ where: { key: { in: ['orderTimings', 'fees'] } } }),
    db.holiday.findMany({ select: { date: true } }),
  ]);
  const value = (key: string) => rows.find((r) => r.key === key)?.value as unknown;
  return {
    timings: { ...DEFAULT_ORDER_TIMINGS, ...(value('orderTimings') as Partial<OrderTimings>) },
    fees: value('fees') as FeeSettings,
    holidays: holidaySet(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  };
}

/** Ledger transaction with a unique external reference: a replay is a no-op. */
export async function writeLedger(
  tx: Prisma.TransactionClient,
  orderId: string | null,
  draft: LedgerTransactionDraft,
  externalRef: string,
): Promise<boolean> {
  const exists = await tx.ledgerTransaction.findUnique({ where: { externalRef } });
  if (exists) return false;
  await tx.ledgerTransaction.create({
    data: { orderId, type: draft.type, externalRef, entries: { create: draft.entries } },
  });
  return true;
}

const outbox = (
  tx: Prisma.TransactionClient,
  aggregateType: string,
  aggregateId: string,
  type: string,
  payload: Prisma.InputJsonValue,
) => tx.outboxEvent.create({ data: { aggregateType, aggregateId, type, payload } });

export interface ApplyOptions {
  handoverPepper: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  now?: Date;
}

/**
 * The only way an existing order changes status (SPEC golden rule): domain transition, optimistic
 * lock on `version`, OrderEvent, synchronous effects (listing, payment ledger, handover code,
 * seller cancellations) and one `order.effects` outbox row for the external ones.
 */
export async function applyOrderEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  event: OrderEvent,
  actor: Actor,
  opts: ApplyOptions,
): Promise<{ order: OrderRow; result: TransitionResult }> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const shipment = await tx.shipment.findFirst({
    where: { orderId, direction: 'OUTBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { estimatedDeliveryAt: true },
  });
  const { timings, holidays } = await loadOrderSettings(tx);
  const now = opts.now ?? new Date();
  const result = transition(snapshot(order, shipment?.estimatedDeliveryAt), event, {
    now,
    holidays,
    timings,
  });

  // The delivery estimate lives on the shipment, not on the order.
  const { estimatedDeliveryAt: _estimate, ...patch } = result.patch;
  const { count } = await tx.order.updateMany({
    where: { id: orderId, version: order.version },
    data: {
      ...patch,
      status: result.to,
      version: { increment: 1 },
      nextAction: result.timer?.action ?? null,
      nextActionAt: result.timer?.at ?? null,
    },
  });
  if (!count) throw new OrderConflictError(`Order ${orderId} changed concurrently`);
  const recorded = await tx.orderEvent.create({
    data: {
      orderId,
      fromStatus: result.from,
      toStatus: result.to,
      event: event.type,
      actorRole: actor.role,
      actorId: actor.id,
      reason: opts.reason ?? null,
      metadata: opts.metadata,
    },
  });
  await applySyncEffects(tx, order, result.effects, opts.handoverPepper);
  // An order closed by its dispute (return accepted or not shipped, release…) closes the dispute.
  if (result.to === 'COMPLETED' || result.to === 'REFUNDED')
    await tx.dispute.updateMany({
      where: {
        orderId,
        status: { in: ['OPEN', 'AWAITING_BUYER', 'UNDER_REVIEW', 'AWAITING_RETURN'] },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        ...(event.type === 'RETURN_NOT_SHIPPED' ? { outcome: 'RELEASE_TO_SELLER' as const } : {}),
      },
    });
  const asyncEffects = result.effects.filter((e) => ASYNC_EFFECTS.has(e.type));
  if (asyncEffects.length)
    await outbox(tx, 'Order', orderId, 'order.effects', {
      orderId,
      eventId: recorded.id,
      effects: asyncEffects as unknown as Prisma.InputJsonValue,
    });
  return { order: await tx.order.findUniqueOrThrow({ where: { id: orderId } }), result };
}

async function applySyncEffects(
  tx: Prisma.TransactionClient,
  order: OrderRow,
  effects: OrderEffect[],
  pepper: string,
) {
  const listingEvent = (type: string) =>
    outbox(tx, 'Listing', order.listingId, type, { listingId: order.listingId, orderId: order.id });
  for (const effect of effects) {
    switch (effect.type) {
      case 'RECORD_PAYMENT_LEDGER':
        await writeLedger(
          tx,
          order.id,
          paymentSucceededEntries(paymentInputOf(order)),
          `payment:${order.id}`,
        );
        if (order.offerId)
          await tx.offer.update({ where: { id: order.offerId }, data: { status: 'CONSUMED' } });
        break;
      case 'RESERVE_LISTING':
        await tx.listing.updateMany({
          where: { id: order.listingId, status: { in: ['ACTIVE', 'RESERVED'] } },
          data: { status: 'RESERVED' },
        });
        await listingEvent('listing.reserved');
        break;
      case 'RELEASE_LISTING': {
        const { count } = await tx.listing.updateMany({
          where: { id: order.listingId, status: 'RESERVED' },
          data: { status: 'ACTIVE' },
        });
        if (count) await listingEvent('listing.released');
        break;
      }
      case 'MARK_LISTING_SOLD':
        await tx.listing.update({
          where: { id: order.listingId },
          data: { status: 'SOLD', soldAt: new Date() },
        });
        await listingEvent('listing.sold');
        break;
      case 'GENERATE_HANDOVER_CODE':
        await tx.order.update({
          where: { id: order.id },
          data: {
            handoverCodeHash: hashHandoverCode(
              deriveHandoverCode(order.id, pepper),
              order.id,
              pepper,
            ),
          },
        });
        break;
      case 'COUNT_SELLER_CANCELLATION':
        await tx.userReputation.upsert({
          where: { userId: order.sellerId },
          create: { userId: order.sellerId, sellerCancellations12m: 1 },
          update: { sellerCancellations12m: { increment: 1 } },
        });
        break;
      default:
        break; // CREATE_PAYMENT_INTENT is done by the checkout itself; the rest is asynchronous.
    }
  }
}
