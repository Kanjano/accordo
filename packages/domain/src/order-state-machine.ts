import type { DeliveryMethod } from './amounts.js';
import { addBusinessDays } from './business-days.js';

export const ORDER_STATUSES = [
  'CHECKOUT_PENDING',
  'PAYMENT_FAILED',
  'EXPIRED',
  'PAID',
  'HANDOVER_PENDING',
  'SHIPPED',
  'DELIVERED',
  'DISPUTED',
  'RETURN_IN_TRANSIT',
  'COMPLETED',
  'REFUNDED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Mirrors the partial unique index "Order_one_active_per_listing" (SPEC §10.2). */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'CHECKOUT_PENDING',
  'PAID',
  'HANDOVER_PENDING',
  'SHIPPED',
  'DELIVERED',
  'DISPUTED',
  'RETURN_IN_TRANSIT',
];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'COMPLETED',
  'REFUNDED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'EXPIRED',
];

export type NextAction =
  | 'EXPIRE_RESERVATION'
  | 'SHIP_REMINDER'
  | 'SHIP_DEADLINE'
  | 'HANDOVER_EXPIRE'
  | 'AUTO_COMPLETE'
  | 'DISPUTE_SELLER_DEADLINE'
  | 'DISPUTE_BUYER_DEADLINE'
  | 'RETURN_SHIP_DEADLINE'
  | 'RETURN_INSPECTION_DEADLINE';

export type DisputeReason =
  | 'NOT_RECEIVED'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED'
  | 'COUNTERFEIT'
  | 'INCOMPLETE'
  | 'OTHER';

export interface CheckoutGuards {
  listingActiveWithProtectedPayment: boolean;
  buyerIsSeller: boolean;
  buyerEmailVerified: boolean;
  listingHasActiveOrder: boolean;
}

export type OrderEvent =
  | { type: 'CHECKOUT_STARTED'; guards: CheckoutGuards }
  | { type: 'PAYMENT_SUCCEEDED'; amountCents: number; currency: string }
  | { type: 'PAYMENT_FAILED' }
  | { type: 'RESERVATION_EXPIRED' }
  | {
      type: 'SHIPMENT_CONFIRMED';
      carrier: string;
      trackingNumber: string;
      estimatedDeliveryAt?: Date | null;
    }
  | { type: 'SELLER_CANCELLED' }
  | { type: 'SHIP_DEADLINE_EXPIRED' }
  | { type: 'MUTUAL_CANCEL' }
  | { type: 'HANDOVER_CODE_VERIFIED' }
  | { type: 'HANDOVER_EXPIRED' }
  | { type: 'DELIVERED'; deliveredAt: Date }
  | { type: 'BUYER_CONFIRMED_RECEIPT'; stepUpVerified: boolean }
  | { type: 'AUTO_COMPLETE_DUE' }
  | { type: 'DISPUTE_OPENED'; reason: DisputeReason }
  | { type: 'RESOLVED_RELEASE' }
  | { type: 'RESOLVED_PARTIAL_REFUND'; refundCents: number }
  | { type: 'RETURN_REQUIRED' }
  | { type: 'RESOLVED_FULL_REFUND' }
  | { type: 'RETURN_ACCEPTED' }
  | { type: 'RETURN_NOT_SHIPPED' };

export type OrderEventType = OrderEvent['type'];

export type OrderEffect =
  | { type: 'CREATE_PAYMENT_INTENT' }
  | { type: 'CANCEL_PAYMENT_INTENT' }
  | { type: 'RECORD_PAYMENT_LEDGER' }
  | { type: 'RESERVE_LISTING' }
  | { type: 'RELEASE_LISTING' }
  | { type: 'MARK_LISTING_SOLD' }
  | { type: 'CREATE_SHIPPING_LABEL' }
  | { type: 'GENERATE_HANDOVER_CODE' }
  | { type: 'REGISTER_TRACKING'; carrier: string; trackingNumber: string }
  | { type: 'CREATE_RETURN_LABEL' }
  | { type: 'TRANSFER_TO_SELLER'; amountCents: number }
  | { type: 'REFUND'; amountCents: number; includesBuyerFee: boolean }
  | { type: 'COUNT_SELLER_CANCELLATION' }
  | { type: 'OPEN_FEEDBACK' }
  | { type: 'NOTIFY'; template: string; to: ReadonlyArray<'BUYER' | 'SELLER' | 'SUPPORT'> };

export interface OrderSnapshot {
  status: OrderStatus | null;
  deliveryMethod: DeliveryMethod;
  currency: string;
  itemPriceCents: number;
  totalCents: number;
  sellerNetCents: number;
  shipBy?: Date | null;
  shippedAt?: Date | null;
  estimatedDeliveryAt?: Date | null;
  deliveredAt?: Date | null;
  autoCompleteAt?: Date | null;
}

export interface OrderTimings {
  checkoutReservationMinutes: number;
  sellerShipDeadlineBusinessDays: number;
  shipReminderHoursBefore: number;
  buyerInspectionHours: number;
  selfShippingAutoCompleteDays: number;
  handoverDeadlineDays: number;
  disputeResponseHours: number;
  returnShipDeadlineBusinessDays: number;
  notReceivedGraceDays: number;
  notReceivedWithoutEstimateDays: number;
}

export const DEFAULT_ORDER_TIMINGS: OrderTimings = {
  checkoutReservationMinutes: 15,
  sellerShipDeadlineBusinessDays: 5,
  shipReminderHoursBefore: 24,
  buyerInspectionHours: 72,
  selfShippingAutoCompleteDays: 10,
  handoverDeadlineDays: 7,
  disputeResponseHours: 72,
  returnShipDeadlineBusinessDays: 5,
  notReceivedGraceDays: 3,
  notReceivedWithoutEstimateDays: 14,
};

export interface TransitionContext {
  now: Date;
  holidays: ReadonlySet<string>;
  timings?: OrderTimings;
}

export type OrderPatch = Partial<{
  reservedUntil: Date | null;
  paidAt: Date;
  shipBy: Date | null;
  shippedAt: Date;
  estimatedDeliveryAt: Date | null;
  deliveredAt: Date;
  autoCompleteAt: Date | null;
  completedAt: Date;
  cancelledAt: Date;
  refundedAt: Date;
  payoutStatus: 'NOT_DUE' | 'SCHEDULED';
}>;

export interface TransitionResult {
  from: OrderStatus | null;
  to: OrderStatus;
  effects: OrderEffect[];
  /** New sweeper timer; null clears it. */
  timer: { action: NextAction; at: Date } | null;
  patch: OrderPatch;
}

export class OrderTransitionError extends Error {
  constructor(
    readonly code: 'INVALID_TRANSITION' | 'GUARD_FAILED',
    readonly from: OrderStatus | null,
    readonly event: OrderEventType,
    detail: string,
  ) {
    super(`${code}: ${from ?? '∅'} --${event}--> ${detail}`);
    this.name = 'OrderTransitionError';
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * Pure order state machine (SPEC §6.4). OrdersService applies the result with optimistic locking,
 * writes OrderEvent + outbox rows, and the worker executes the effects.
 */
export function transition(
  order: OrderSnapshot,
  event: OrderEvent,
  ctx: TransitionContext,
): TransitionResult {
  const t = ctx.timings ?? DEFAULT_ORDER_TIMINGS;
  const { now } = ctx;
  const from = order.status;
  const guard = (ok: boolean, detail: string) => {
    if (!ok) throw new OrderTransitionError('GUARD_FAILED', from, event.type, detail);
  };
  const result = (
    to: OrderStatus,
    effects: OrderEffect[],
    timer: TransitionResult['timer'] = null,
    patch: OrderPatch = {},
  ): TransitionResult => ({ from, to, effects, timer, patch });

  const fullRefund: OrderEffect = {
    type: 'REFUND',
    amountCents: order.totalCents,
    includesBuyerFee: true,
  };
  const complete = (template: string): TransitionResult =>
    result(
      'COMPLETED',
      [
        { type: 'TRANSFER_TO_SELLER', amountCents: order.sellerNetCents },
        { type: 'MARK_LISTING_SOLD' },
        { type: 'OPEN_FEEDBACK' },
        { type: 'NOTIFY', template, to: ['BUYER', 'SELLER'] },
      ],
      null,
      { completedAt: now, payoutStatus: 'SCHEDULED' },
    );
  const cancel = (extra: OrderEffect[], template: string): TransitionResult =>
    result(
      'CANCELLED',
      [
        fullRefund,
        { type: 'RELEASE_LISTING' },
        ...extra,
        { type: 'NOTIFY', template, to: ['BUYER', 'SELLER'] },
      ],
      null,
      { cancelledAt: now },
    );
  const autoCompleteDue = () =>
    guard(!!order.autoCompleteAt && now >= order.autoCompleteAt, 'auto-complete not due yet');

  switch (`${from ?? 'NEW'}:${event.type}`) {
    case 'NEW:CHECKOUT_STARTED': {
      const g = (event as Extract<OrderEvent, { type: 'CHECKOUT_STARTED' }>).guards;
      guard(g.listingActiveWithProtectedPayment, 'listing must be ACTIVE with protected payment');
      guard(!g.buyerIsSeller, 'buyer cannot be the seller');
      guard(g.buyerEmailVerified, 'buyer email must be verified');
      guard(!g.listingHasActiveOrder, 'listing already has an active order');
      const reservedUntil = plus(now, t.checkoutReservationMinutes * 60_000);
      return result(
        'CHECKOUT_PENDING',
        [{ type: 'CREATE_PAYMENT_INTENT' }],
        { action: 'EXPIRE_RESERVATION', at: reservedUntil },
        { reservedUntil },
      );
    }

    case 'CHECKOUT_PENDING:PAYMENT_SUCCEEDED': {
      const e = event as Extract<OrderEvent, { type: 'PAYMENT_SUCCEEDED' }>;
      guard(
        e.amountCents === order.totalCents &&
          e.currency.toUpperCase() === order.currency.toUpperCase(),
        'amount or currency mismatch',
      );
      const common: OrderEffect[] = [
        { type: 'RECORD_PAYMENT_LEDGER' },
        { type: 'RESERVE_LISTING' },
      ];
      if (order.deliveryMethod === 'HAND_DELIVERY') {
        return result(
          'HANDOVER_PENDING',
          [
            ...common,
            { type: 'GENERATE_HANDOVER_CODE' },
            { type: 'NOTIFY', template: 'order.paid.handover', to: ['BUYER', 'SELLER'] },
          ],
          { action: 'HANDOVER_EXPIRE', at: plus(now, t.handoverDeadlineDays * DAY) },
          { paidAt: now, reservedUntil: null },
        );
      }
      const shipBy = addBusinessDays(now, t.sellerShipDeadlineBusinessDays, ctx.holidays);
      const reminderAt = plus(shipBy, -t.shipReminderHoursBefore * HOUR);
      const effects: OrderEffect[] = [...common];
      if (order.deliveryMethod === 'SHIPPING_INTEGRATED')
        effects.push({ type: 'CREATE_SHIPPING_LABEL' });
      effects.push({ type: 'NOTIFY', template: 'order.paid', to: ['BUYER', 'SELLER'] });
      return result(
        'PAID',
        effects,
        reminderAt > now
          ? { action: 'SHIP_REMINDER', at: reminderAt }
          : { action: 'SHIP_DEADLINE', at: shipBy },
        { paidAt: now, shipBy, reservedUntil: null },
      );
    }
    case 'CHECKOUT_PENDING:PAYMENT_FAILED':
      return result('PAYMENT_FAILED', [{ type: 'RELEASE_LISTING' }], null, { reservedUntil: null });
    case 'CHECKOUT_PENDING:RESERVATION_EXPIRED':
      return result(
        'EXPIRED',
        [{ type: 'CANCEL_PAYMENT_INTENT' }, { type: 'RELEASE_LISTING' }],
        null,
        { reservedUntil: null },
      );

    case 'PAID:SHIPMENT_CONFIRMED': {
      const e = event as Extract<OrderEvent, { type: 'SHIPMENT_CONFIRMED' }>;
      guard(
        e.trackingNumber.trim().length > 0 && e.carrier.trim().length > 0,
        'tracking is required',
      );
      const patch: OrderPatch = {
        shippedAt: now,
        estimatedDeliveryAt: e.estimatedDeliveryAt ?? null,
      };
      const effects: OrderEffect[] = [];
      let timer: TransitionResult['timer'] = null;
      if (order.deliveryMethod === 'SHIPPING_SELF') {
        effects.push({
          type: 'REGISTER_TRACKING',
          carrier: e.carrier,
          trackingNumber: e.trackingNumber,
        });
        patch.autoCompleteAt = plus(now, t.selfShippingAutoCompleteDays * DAY);
        timer = { action: 'AUTO_COMPLETE', at: patch.autoCompleteAt };
      }
      effects.push({ type: 'NOTIFY', template: 'order.shipped', to: ['BUYER'] });
      return result('SHIPPED', effects, timer, patch);
    }
    case 'PAID:SELLER_CANCELLED':
      return cancel([{ type: 'COUNT_SELLER_CANCELLATION' }], 'order.cancelled.seller');
    case 'PAID:SHIP_DEADLINE_EXPIRED':
      return cancel([{ type: 'COUNT_SELLER_CANCELLATION' }], 'order.cancelled.ship_deadline');
    case 'PAID:MUTUAL_CANCEL':
      return cancel([], 'order.cancelled.mutual');

    case 'HANDOVER_PENDING:HANDOVER_CODE_VERIFIED':
      return complete('order.completed.handover');
    case 'HANDOVER_PENDING:HANDOVER_EXPIRED':
      return cancel([], 'order.cancelled.handover_expired');
    case 'HANDOVER_PENDING:MUTUAL_CANCEL':
      return cancel([], 'order.cancelled.mutual');

    case 'SHIPPED:DELIVERED':
    case 'SHIPPED:BUYER_CONFIRMED_RECEIPT':
    case 'SHIPPED:AUTO_COMPLETE_DUE':
    case 'SHIPPED:DISPUTE_OPENED':
      return fromShipped();

    case 'DELIVERED:BUYER_CONFIRMED_RECEIPT':
      guard(
        (event as Extract<OrderEvent, { type: 'BUYER_CONFIRMED_RECEIPT' }>).stepUpVerified,
        'step-up authentication required',
      );
      return complete('order.completed');
    case 'DELIVERED:AUTO_COMPLETE_DUE':
      autoCompleteDue();
      return complete('order.completed.auto');
    case 'DELIVERED:DISPUTE_OPENED': {
      const e = event as Extract<OrderEvent, { type: 'DISPUTE_OPENED' }>;
      guard(e.reason !== 'NOT_RECEIVED', 'item was delivered: use a not-as-described reason');
      guard(
        !!order.deliveredAt && now <= plus(order.deliveredAt, t.buyerInspectionHours * HOUR),
        'inspection window is over',
      );
      return openDispute();
    }

    case 'DISPUTED:RESOLVED_RELEASE':
      return complete('dispute.resolved.release');
    case 'DISPUTED:RESOLVED_PARTIAL_REFUND': {
      const { refundCents } = event as Extract<OrderEvent, { type: 'RESOLVED_PARTIAL_REFUND' }>;
      guard(
        Number.isSafeInteger(refundCents) && refundCents > 0 && refundCents <= order.itemPriceCents,
        'refund must be > 0 and ≤ item price',
      );
      const r = complete('dispute.resolved.partial_refund');
      r.effects[0] = {
        type: 'TRANSFER_TO_SELLER',
        amountCents: order.sellerNetCents - refundCents,
      };
      r.effects.unshift({ type: 'REFUND', amountCents: refundCents, includesBuyerFee: false });
      return r;
    }
    case 'DISPUTED:RETURN_REQUIRED':
      return result(
        'RETURN_IN_TRANSIT',
        [
          { type: 'CREATE_RETURN_LABEL' },
          { type: 'NOTIFY', template: 'dispute.return_required', to: ['BUYER', 'SELLER'] },
        ],
        {
          action: 'RETURN_SHIP_DEADLINE',
          at: addBusinessDays(now, t.returnShipDeadlineBusinessDays, ctx.holidays),
        },
      );
    case 'DISPUTED:RESOLVED_FULL_REFUND':
      return refunded('dispute.resolved.full_refund');

    case 'RETURN_IN_TRANSIT:RETURN_ACCEPTED':
      return refunded('dispute.return_accepted');
    case 'RETURN_IN_TRANSIT:RETURN_NOT_SHIPPED':
      return complete('dispute.return_not_shipped');
  }

  throw new OrderTransitionError('INVALID_TRANSITION', from, event.type, 'not allowed');

  function fromShipped(): TransitionResult {
    switch (event.type) {
      case 'DELIVERED': {
        const autoCompleteAt = plus(event.deliveredAt, t.buyerInspectionHours * HOUR);
        return result(
          'DELIVERED',
          [{ type: 'NOTIFY', template: 'order.delivered', to: ['BUYER', 'SELLER'] }],
          { action: 'AUTO_COMPLETE', at: autoCompleteAt },
          { deliveredAt: event.deliveredAt, autoCompleteAt },
        );
      }
      case 'BUYER_CONFIRMED_RECEIPT':
        guard(event.stepUpVerified, 'step-up authentication required');
        return complete('order.completed');
      case 'AUTO_COMPLETE_DUE':
        guard(
          order.deliveryMethod === 'SHIPPING_SELF',
          'auto-complete without delivery is only for self shipping',
        );
        autoCompleteDue();
        return complete('order.completed.auto');
      default: {
        const e = event as Extract<OrderEvent, { type: 'DISPUTE_OPENED' }>;
        guard(
          e.reason === 'NOT_RECEIVED',
          'before delivery only "not received" disputes are allowed',
        );
        const openableAt = order.estimatedDeliveryAt
          ? plus(order.estimatedDeliveryAt, t.notReceivedGraceDays * DAY)
          : order.shippedAt
            ? plus(order.shippedAt, t.notReceivedWithoutEstimateDays * DAY)
            : null;
        guard(!!openableAt && now >= openableAt, 'too early to report the item as not received');
        return openDispute();
      }
    }
  }

  function openDispute(): TransitionResult {
    return result(
      'DISPUTED',
      [{ type: 'NOTIFY', template: 'dispute.opened', to: ['BUYER', 'SELLER'] }],
      { action: 'DISPUTE_SELLER_DEADLINE', at: plus(now, t.disputeResponseHours * HOUR) },
      { autoCompleteAt: null },
    );
  }

  function refunded(template: string): TransitionResult {
    return result(
      'REFUNDED',
      [
        fullRefund,
        { type: 'RELEASE_LISTING' },
        { type: 'NOTIFY', template, to: ['BUYER', 'SELLER'] },
      ],
      null,
      { refundedAt: now },
    );
  }
}

/** What the order sweeper does for a due `nextAction` that belongs to the order lifecycle. */
export type SweeperStep =
  | { kind: 'event'; event: OrderEvent }
  | { kind: 'reminder'; effects: OrderEffect[]; timer: { action: NextAction; at: Date } | null };

export function sweeperStep(action: NextAction, order: OrderSnapshot): SweeperStep | null {
  switch (action) {
    case 'EXPIRE_RESERVATION':
      return { kind: 'event', event: { type: 'RESERVATION_EXPIRED' } };
    case 'SHIP_REMINDER':
      return {
        kind: 'reminder',
        effects: [{ type: 'NOTIFY', template: 'order.ship_reminder', to: ['SELLER'] }],
        timer: order.shipBy ? { action: 'SHIP_DEADLINE', at: order.shipBy } : null,
      };
    case 'SHIP_DEADLINE':
      return { kind: 'event', event: { type: 'SHIP_DEADLINE_EXPIRED' } };
    case 'HANDOVER_EXPIRE':
      return { kind: 'event', event: { type: 'HANDOVER_EXPIRED' } };
    case 'AUTO_COMPLETE':
      return { kind: 'event', event: { type: 'AUTO_COMPLETE_DUE' } };
    case 'RETURN_SHIP_DEADLINE':
      return { kind: 'event', event: { type: 'RETURN_NOT_SHIPPED' } };
    case 'RETURN_INSPECTION_DEADLINE':
      return { kind: 'event', event: { type: 'RETURN_ACCEPTED' } };
    default:
      // Dispute deadlines are driven by the disputes module (Phase 8).
      return null;
  }
}
