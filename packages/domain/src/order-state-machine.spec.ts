import { describe, expect, it } from 'vitest';
import { holidaySet, italianHolidays } from './business-days.js';
import {
  DEFAULT_ORDER_TIMINGS,
  type NextAction,
  ORDER_STATUSES,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
  OrderTransitionError,
  sweeperStep,
  transition,
} from './order-state-machine.js';

const now = new Date('2026-11-02T09:00:00Z'); // Monday 10:00 Rome
const ctx = { now, holidays: holidaySet(italianHolidays(2026)) };
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(now.getTime() - ms);

const order = (status: OrderStatus | null, over: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  status,
  deliveryMethod: 'SHIPPING_INTEGRATED',
  currency: 'EUR',
  itemPriceCents: 80_000,
  totalCents: 83_790,
  sellerNetCents: 80_000,
  ...over,
});

const okGuards = {
  listingActiveWithProtectedPayment: true,
  buyerIsSeller: false,
  buyerEmailVerified: true,
  listingHasActiveOrder: false,
};

const ALL_EVENTS: OrderEvent[] = [
  { type: 'CHECKOUT_STARTED', guards: okGuards },
  { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'eur' },
  { type: 'PAYMENT_FAILED' },
  { type: 'RESERVATION_EXPIRED' },
  { type: 'SHIPMENT_CONFIRMED', carrier: 'BRT', trackingNumber: 'X1' },
  { type: 'SELLER_CANCELLED' },
  { type: 'SHIP_DEADLINE_EXPIRED' },
  { type: 'MUTUAL_CANCEL' },
  { type: 'HANDOVER_CODE_VERIFIED' },
  { type: 'HANDOVER_EXPIRED' },
  { type: 'DELIVERED', deliveredAt: ago(H) },
  { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: true },
  { type: 'AUTO_COMPLETE_DUE' },
  { type: 'DISPUTE_OPENED', reason: 'NOT_AS_DESCRIBED' },
  { type: 'RESOLVED_RELEASE' },
  { type: 'RESOLVED_PARTIAL_REFUND', refundCents: 10_000 },
  { type: 'RETURN_REQUIRED' },
  { type: 'RESOLVED_FULL_REFUND' },
  { type: 'RETURN_ACCEPTED' },
  { type: 'RETURN_NOT_SHIPPED' },
];

/** Every allowed row of SPEC §6.4, with a snapshot that satisfies its guards. */
const VALID: Array<[OrderStatus | null, OrderEvent, OrderStatus, Partial<OrderSnapshot>?]> = [
  [null, { type: 'CHECKOUT_STARTED', guards: okGuards }, 'CHECKOUT_PENDING'],
  ['CHECKOUT_PENDING', { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' }, 'PAID'],
  [
    'CHECKOUT_PENDING',
    { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' },
    'HANDOVER_PENDING',
    { deliveryMethod: 'HAND_DELIVERY' },
  ],
  ['CHECKOUT_PENDING', { type: 'PAYMENT_FAILED' }, 'PAYMENT_FAILED'],
  ['CHECKOUT_PENDING', { type: 'RESERVATION_EXPIRED' }, 'EXPIRED'],
  ['PAID', { type: 'SHIPMENT_CONFIRMED', carrier: 'BRT', trackingNumber: 'X1' }, 'SHIPPED'],
  ['PAID', { type: 'SELLER_CANCELLED' }, 'CANCELLED'],
  ['PAID', { type: 'SHIP_DEADLINE_EXPIRED' }, 'CANCELLED'],
  ['PAID', { type: 'MUTUAL_CANCEL' }, 'CANCELLED'],
  [
    'HANDOVER_PENDING',
    { type: 'HANDOVER_CODE_VERIFIED' },
    'COMPLETED',
    { deliveryMethod: 'HAND_DELIVERY' },
  ],
  [
    'HANDOVER_PENDING',
    { type: 'HANDOVER_EXPIRED' },
    'CANCELLED',
    { deliveryMethod: 'HAND_DELIVERY' },
  ],
  ['HANDOVER_PENDING', { type: 'MUTUAL_CANCEL' }, 'CANCELLED', { deliveryMethod: 'HAND_DELIVERY' }],
  ['SHIPPED', { type: 'DELIVERED', deliveredAt: ago(H) }, 'DELIVERED'],
  ['SHIPPED', { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: true }, 'COMPLETED'],
  [
    'SHIPPED',
    { type: 'AUTO_COMPLETE_DUE' },
    'COMPLETED',
    { deliveryMethod: 'SHIPPING_SELF', autoCompleteAt: ago(1) },
  ],
  [
    'SHIPPED',
    { type: 'DISPUTE_OPENED', reason: 'NOT_RECEIVED' },
    'DISPUTED',
    { estimatedDeliveryAt: ago(3 * D) },
  ],
  ['DELIVERED', { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: true }, 'COMPLETED'],
  ['DELIVERED', { type: 'AUTO_COMPLETE_DUE' }, 'COMPLETED', { autoCompleteAt: ago(1) }],
  [
    'DELIVERED',
    { type: 'DISPUTE_OPENED', reason: 'DAMAGED' },
    'DISPUTED',
    { deliveredAt: ago(71 * H) },
  ],
  ['DISPUTED', { type: 'RESOLVED_RELEASE' }, 'COMPLETED'],
  ['DISPUTED', { type: 'RESOLVED_PARTIAL_REFUND', refundCents: 10_000 }, 'COMPLETED'],
  ['DISPUTED', { type: 'RETURN_REQUIRED' }, 'RETURN_IN_TRANSIT'],
  ['DISPUTED', { type: 'RESOLVED_FULL_REFUND' }, 'REFUNDED'],
  ['RETURN_IN_TRANSIT', { type: 'RETURN_ACCEPTED' }, 'REFUNDED'],
  ['RETURN_IN_TRANSIT', { type: 'RETURN_NOT_SHIPPED' }, 'COMPLETED'],
];

describe('transition — allowed rows', () => {
  it.each(VALID)('%s --%o--> %s', (from, event, to, over) => {
    const r = transition(order(from, over), event, ctx);
    expect(r).toMatchObject({ from, to });
  });
});

describe('transition — every other (status, event) pair is rejected', () => {
  const allowed = new Set(VALID.map(([s, e]) => `${s}:${e.type}`));
  const pairs = [null, ...ORDER_STATUSES].flatMap((s) =>
    ALL_EVENTS.filter((e) => !allowed.has(`${s}:${e.type}`)).map((e) => [s, e] as const),
  );
  it.each(pairs)('%s + %o', (status, event) => {
    expect(() => transition(order(status), event, ctx)).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });
  it('rejects terminal states for every event', () => {
    expect(pairs.filter(([s]) => s === 'COMPLETED')).toHaveLength(ALL_EVENTS.length);
  });
});

describe('effects and timers', () => {
  it('checkout reserves for 15 minutes and creates the PaymentIntent', () => {
    const r = transition(order(null), { type: 'CHECKOUT_STARTED', guards: okGuards }, ctx);
    expect(r.effects).toEqual([{ type: 'CREATE_PAYMENT_INTENT' }]);
    expect(r.timer).toEqual({
      action: 'EXPIRE_RESERVATION',
      at: new Date(now.getTime() + 15 * 60_000),
    });
  });

  it.each([
    ['listingActiveWithProtectedPayment', false],
    ['buyerIsSeller', true],
    ['buyerEmailVerified', false],
    ['listingHasActiveOrder', true],
  ] as const)('checkout guard %s=%s', (key, value) => {
    expect(() =>
      transition(
        order(null),
        { type: 'CHECKOUT_STARTED', guards: { ...okGuards, [key]: value } },
        ctx,
      ),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }));
  });

  it('payment must match amount and currency', () => {
    for (const e of [
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_789, currency: 'EUR' },
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'USD' },
    ] as const) {
      expect(() => transition(order('CHECKOUT_PENDING'), e, ctx)).toThrow(OrderTransitionError);
    }
  });

  it('paid with integrated shipping: label, ship-by in 5 business days, reminder 24h before', () => {
    const r = transition(
      order('CHECKOUT_PENDING'),
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' },
      ctx,
    );
    expect(r.effects.map((e) => e.type)).toEqual([
      'RECORD_PAYMENT_LEDGER',
      'RESERVE_LISTING',
      'CREATE_SHIPPING_LABEL',
      'NOTIFY',
    ]);
    expect(r.patch.shipBy?.toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(r.timer).toEqual({ action: 'SHIP_REMINDER', at: new Date('2026-11-08T09:00:00Z') });
  });

  it('paid with self shipping: no label', () => {
    const r = transition(
      order('CHECKOUT_PENDING', { deliveryMethod: 'SHIPPING_SELF' }),
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' },
      ctx,
    );
    expect(r.effects.map((e) => e.type)).not.toContain('CREATE_SHIPPING_LABEL');
  });

  it('falls back to the deadline when the reminder would be in the past', () => {
    const r = transition(
      order('CHECKOUT_PENDING'),
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' },
      { ...ctx, timings: { ...DEFAULT_ORDER_TIMINGS, sellerShipDeadlineBusinessDays: 0 } },
    );
    expect(r.timer?.action).toBe('SHIP_DEADLINE');
  });

  it('hand delivery generates the code and expires after 7 days', () => {
    const r = transition(
      order('CHECKOUT_PENDING', { deliveryMethod: 'HAND_DELIVERY' }),
      { type: 'PAYMENT_SUCCEEDED', amountCents: 83_790, currency: 'EUR' },
      ctx,
    );
    expect(r.effects.map((e) => e.type)).toContain('GENERATE_HANDOVER_CODE');
    expect(r.timer).toEqual({ action: 'HANDOVER_EXPIRE', at: new Date(now.getTime() + 7 * D) });
  });

  it('self shipping: tracking registered and auto-complete after 10 days', () => {
    const r = transition(
      order('PAID', { deliveryMethod: 'SHIPPING_SELF' }),
      { type: 'SHIPMENT_CONFIRMED', carrier: 'Poste', trackingNumber: 'RR123' },
      ctx,
    );
    expect(r.effects[0]).toEqual({
      type: 'REGISTER_TRACKING',
      carrier: 'Poste',
      trackingNumber: 'RR123',
    });
    expect(r.timer).toEqual({ action: 'AUTO_COMPLETE', at: new Date(now.getTime() + 10 * D) });
  });

  it('integrated shipping: no auto-complete before delivery; tracking required', () => {
    expect(
      transition(
        order('PAID'),
        { type: 'SHIPMENT_CONFIRMED', carrier: 'BRT', trackingNumber: 'X' },
        ctx,
      ).timer,
    ).toBeNull();
    expect(() =>
      transition(
        order('PAID'),
        { type: 'SHIPMENT_CONFIRMED', carrier: 'BRT', trackingNumber: ' ' },
        ctx,
      ),
    ).toThrow(/tracking/);
  });

  it('seller-caused cancellations refund in full and count against the seller', () => {
    for (const type of ['SELLER_CANCELLED', 'SHIP_DEADLINE_EXPIRED'] as const) {
      const r = transition(order('PAID'), { type }, ctx);
      expect(r.effects).toContainEqual({
        type: 'REFUND',
        amountCents: 83_790,
        includesBuyerFee: true,
      });
      expect(r.effects).toContainEqual({ type: 'COUNT_SELLER_CANCELLATION' });
    }
    expect(transition(order('PAID'), { type: 'MUTUAL_CANCEL' }, ctx).effects).not.toContainEqual({
      type: 'COUNT_SELLER_CANCELLATION',
    });
  });

  it('delivery starts the 72h inspection window', () => {
    const deliveredAt = ago(H);
    const r = transition(order('SHIPPED'), { type: 'DELIVERED', deliveredAt }, ctx);
    expect(r.timer).toEqual({
      action: 'AUTO_COMPLETE',
      at: new Date(deliveredAt.getTime() + 72 * H),
    });
  });

  it('completion transfers the seller net, marks sold and opens feedback', () => {
    const r = transition(
      order('DELIVERED'),
      { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: true },
      ctx,
    );
    expect(r.effects.slice(0, 3)).toEqual([
      { type: 'TRANSFER_TO_SELLER', amountCents: 80_000 },
      { type: 'MARK_LISTING_SOLD' },
      { type: 'OPEN_FEEDBACK' },
    ]);
    expect(r.patch).toMatchObject({ completedAt: now, payoutStatus: 'SCHEDULED' });
    expect(r.timer).toBeNull();
  });

  it('confirming receipt requires step-up', () => {
    for (const s of ['SHIPPED', 'DELIVERED'] as const) {
      expect(() =>
        transition(order(s), { type: 'BUYER_CONFIRMED_RECEIPT', stepUpVerified: false }, ctx),
      ).toThrow(/step-up/);
    }
  });

  it('auto-complete guards', () => {
    expect(() =>
      transition(order('SHIPPED', { autoCompleteAt: ago(1) }), { type: 'AUTO_COMPLETE_DUE' }, ctx),
    ).toThrow(/self shipping/);
    expect(() =>
      transition(
        order('SHIPPED', { deliveryMethod: 'SHIPPING_SELF', autoCompleteAt: ago(-1000) }),
        { type: 'AUTO_COMPLETE_DUE' },
        ctx,
      ),
    ).toThrow(/not due/);
    expect(() => transition(order('DELIVERED'), { type: 'AUTO_COMPLETE_DUE' }, ctx)).toThrow(
      /not due/,
    );
  });

  it('"not received" disputes open only after estimate + 3 days or 14 days from shipping', () => {
    const e: OrderEvent = { type: 'DISPUTE_OPENED', reason: 'NOT_RECEIVED' };
    expect(() => transition(order('SHIPPED', { estimatedDeliveryAt: ago(2 * D) }), e, ctx)).toThrow(
      /too early/,
    );
    expect(() => transition(order('SHIPPED', { shippedAt: ago(13 * D) }), e, ctx)).toThrow(
      /too early/,
    );
    expect(transition(order('SHIPPED', { shippedAt: ago(14 * D) }), e, ctx).to).toBe('DISPUTED');
    expect(() => transition(order('SHIPPED'), e, ctx)).toThrow(/too early/);
    expect(() =>
      transition(
        order('SHIPPED', { shippedAt: ago(20 * D) }),
        { type: 'DISPUTE_OPENED', reason: 'DAMAGED' },
        ctx,
      ),
    ).toThrow(/not received/);
  });

  it('post-delivery disputes: within 72h, not "not received"; seller has 72h', () => {
    const r = transition(
      order('DELIVERED', { deliveredAt: ago(H) }),
      { type: 'DISPUTE_OPENED', reason: 'COUNTERFEIT' },
      ctx,
    );
    expect(r.timer).toEqual({
      action: 'DISPUTE_SELLER_DEADLINE',
      at: new Date(now.getTime() + 72 * H),
    });
    expect(r.patch.autoCompleteAt).toBeNull();
    expect(() =>
      transition(
        order('DELIVERED', { deliveredAt: ago(73 * H) }),
        { type: 'DISPUTE_OPENED', reason: 'DAMAGED' },
        ctx,
      ),
    ).toThrow(/window/);
    expect(() =>
      transition(
        order('DELIVERED', { deliveredAt: ago(H) }),
        { type: 'DISPUTE_OPENED', reason: 'NOT_RECEIVED' },
        ctx,
      ),
    ).toThrow();
  });

  it('partial refund: refunds the item part only and transfers the rest', () => {
    const r = transition(
      order('DISPUTED'),
      { type: 'RESOLVED_PARTIAL_REFUND', refundCents: 15_000 },
      ctx,
    );
    expect(r.effects.slice(0, 2)).toEqual([
      { type: 'REFUND', amountCents: 15_000, includesBuyerFee: false },
      { type: 'TRANSFER_TO_SELLER', amountCents: 65_000 },
    ]);
    for (const refundCents of [0, 80_001, 1.5]) {
      expect(() =>
        transition(order('DISPUTED'), { type: 'RESOLVED_PARTIAL_REFUND', refundCents }, ctx),
      ).toThrow(/refund/);
    }
  });

  it('return flow', () => {
    const r = transition(order('DISPUTED'), { type: 'RETURN_REQUIRED' }, ctx);
    expect(r.effects[0]).toEqual({ type: 'CREATE_RETURN_LABEL' });
    expect(r.timer?.action).toBe('RETURN_SHIP_DEADLINE');
    const refunded = transition(order('RETURN_IN_TRANSIT'), { type: 'RETURN_ACCEPTED' }, ctx);
    expect(refunded.effects[0]).toEqual({
      type: 'REFUND',
      amountCents: 83_790,
      includesBuyerFee: true,
    });
    expect(refunded.patch.refundedAt).toEqual(now);
  });
});

describe('sweeperStep', () => {
  const o = order('PAID', { shipBy: new Date('2026-11-09T09:00:00Z') });
  it.each([
    ['EXPIRE_RESERVATION', 'RESERVATION_EXPIRED'],
    ['SHIP_DEADLINE', 'SHIP_DEADLINE_EXPIRED'],
    ['HANDOVER_EXPIRE', 'HANDOVER_EXPIRED'],
    ['AUTO_COMPLETE', 'AUTO_COMPLETE_DUE'],
    ['RETURN_SHIP_DEADLINE', 'RETURN_NOT_SHIPPED'],
    ['RETURN_INSPECTION_DEADLINE', 'RETURN_ACCEPTED'],
  ] as const)('%s → %s', (action, type) => {
    expect(sweeperStep(action, o)).toEqual({ kind: 'event', event: { type } });
  });

  it('ship reminder notifies and schedules the deadline', () => {
    expect(sweeperStep('SHIP_REMINDER', o)).toEqual({
      kind: 'reminder',
      effects: [{ type: 'NOTIFY', template: 'order.ship_reminder', to: ['SELLER'] }],
      timer: { action: 'SHIP_DEADLINE', at: o.shipBy },
    });
    expect(sweeperStep('SHIP_REMINDER', order('PAID'))).toMatchObject({ timer: null });
  });

  it('dispute deadlines belong to the disputes module', () => {
    for (const a of ['DISPUTE_SELLER_DEADLINE', 'DISPUTE_BUYER_DEADLINE'] satisfies NextAction[]) {
      expect(sweeperStep(a, o)).toBeNull();
    }
  });
});
