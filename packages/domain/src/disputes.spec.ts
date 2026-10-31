import { describe, expect, it } from 'vitest';
import {
  DisputeActionError,
  type DisputeSnapshot,
  disputeOpeningError,
  disputeStep,
} from './disputes.js';

const now = new Date('2026-11-10T10:00:00Z');
const base: DisputeSnapshot = {
  status: 'OPEN',
  proposedRefundCents: null,
  resolvedAt: null,
  resolvedById: null,
  appealedAt: null,
  appealResolvedAt: null,
  orderStatus: 'DISPUTED',
  itemPriceCents: 10_000,
  returnDelivered: false,
};
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DisputeActionError).code;
  }
  return null;
};

describe('opening', () => {
  it('needs 30 characters and 2 photos for condition reasons', () => {
    expect(
      disputeOpeningError({ reason: 'NOT_RECEIVED', description: 'x'.repeat(30), photos: 0 }),
    ).toBeNull();
    expect(disputeOpeningError({ reason: 'DAMAGED', description: 'x'.repeat(30), photos: 1 })).toBe(
      'PHOTOS_REQUIRED',
    );
    expect(disputeOpeningError({ reason: 'OTHER', description: 'troppo corta', photos: 0 })).toBe(
      'DESCRIPTION_TOO_SHORT',
    );
  });
});

describe('seller response', () => {
  it('accepting with return moves the order to the return', () => {
    const s = disputeStep(
      base,
      { type: 'SELLER_RESPOND', response: 'ACCEPT_REFUND_WITH_RETURN' },
      'SELLER',
      now,
    );
    expect(s).toMatchObject({ status: 'AWAITING_RETURN', orderEvent: { type: 'RETURN_REQUIRED' } });
  });
  it('accepting the refund resolves with a full refund', () => {
    const s = disputeStep(
      base,
      { type: 'SELLER_RESPOND', response: 'ACCEPT_REFUND' },
      'SELLER',
      now,
    );
    expect(s).toMatchObject({
      status: 'RESOLVED',
      patch: { outcome: 'REFUND_FULL', resolvedAt: now },
      orderEvent: { type: 'RESOLVED_FULL_REFUND' },
    });
  });
  it('a partial proposal waits 72 h for the buyer, within the item price', () => {
    const s = disputeStep(
      base,
      { type: 'SELLER_RESPOND', response: 'PROPOSE_PARTIAL', amountCents: 3000 },
      'SELLER',
      now,
    );
    expect(s.status).toBe('AWAITING_BUYER');
    expect(s.orderTimer).toEqual({
      action: 'DISPUTE_BUYER_DEADLINE',
      at: new Date('2026-11-13T10:00:00Z'),
    });
    expect(
      err(() =>
        disputeStep(
          base,
          { type: 'SELLER_RESPOND', response: 'PROPOSE_PARTIAL', amountCents: 10_001 },
          'SELLER',
          now,
        ),
      ),
    ).toBe('REFUND_OUT_OF_RANGE');
    expect(
      err(() =>
        disputeStep(base, { type: 'SELLER_RESPOND', response: 'PROPOSE_PARTIAL' }, 'SELLER', now),
      ),
    ).toBe('REFUND_OUT_OF_RANGE');
  });
  it('rejecting escalates to the staff; only the seller responds, only once', () => {
    expect(
      disputeStep(base, { type: 'SELLER_RESPOND', response: 'REJECT' }, 'SELLER', now),
    ).toMatchObject({ status: 'UNDER_REVIEW', orderTimer: null });
    expect(
      err(() => disputeStep(base, { type: 'SELLER_RESPOND', response: 'REJECT' }, 'BUYER', now)),
    ).toBe('NOT_ALLOWED');
    expect(
      err(() =>
        disputeStep(
          { ...base, status: 'UNDER_REVIEW' },
          { type: 'SELLER_RESPOND', response: 'REJECT' },
          'SELLER',
          now,
        ),
      ),
    ).toBe('INVALID_DISPUTE_STATE');
    expect(
      err(() =>
        disputeStep(base, { type: 'SELLER_RESPOND', response: 'X' as never }, 'SELLER', now),
      ),
    ).toBe('INVALID_RESPONSE');
  });
});

describe('buyer, deadlines and escalation', () => {
  const awaiting = { ...base, status: 'AWAITING_BUYER' as const, proposedRefundCents: 3000 };
  it('the buyer accepts the proposal: partial refund on the item', () => {
    expect(disputeStep(awaiting, { type: 'ACCEPT_PROPOSAL' }, 'BUYER', now)).toMatchObject({
      status: 'RESOLVED',
      patch: { outcome: 'REFUND_PARTIAL', resolvedRefundCents: 3000 },
      orderEvent: { type: 'RESOLVED_PARTIAL_REFUND', refundCents: 3000 },
    });
  });
  it('either party escalates; missed deadlines escalate automatically', () => {
    expect(disputeStep(base, { type: 'ESCALATE' }, 'BUYER', now).status).toBe('UNDER_REVIEW');
    expect(disputeStep(awaiting, { type: 'DEADLINE' }, 'SYSTEM', now).status).toBe('UNDER_REVIEW');
    expect(err(() => disputeStep(base, { type: 'DEADLINE' }, 'BUYER', now))).toBe('NOT_ALLOWED');
  });
  it('after the return is delivered only the seller may contest it', () => {
    const ret = {
      ...base,
      status: 'AWAITING_RETURN' as const,
      orderStatus: 'RETURN_IN_TRANSIT' as const,
    };
    expect(err(() => disputeStep(ret, { type: 'ESCALATE' }, 'SELLER', now))).toBe(
      'INVALID_DISPUTE_STATE',
    );
    expect(
      err(() => disputeStep({ ...ret, returnDelivered: true }, { type: 'ESCALATE' }, 'BUYER', now)),
    ).toBe('INVALID_DISPUTE_STATE');
    expect(
      disputeStep({ ...ret, returnDelivered: true }, { type: 'ESCALATE' }, 'SELLER', now).status,
    ).toBe('UNDER_REVIEW');
  });
  it('the buyer may withdraw: the seller is paid', () => {
    expect(disputeStep(base, { type: 'WITHDRAW' }, 'BUYER', now)).toMatchObject({
      status: 'WITHDRAWN',
      orderEvent: { type: 'RESOLVED_RELEASE' },
    });
    expect(err(() => disputeStep(base, { type: 'WITHDRAW' }, 'SELLER', now))).toBe('NOT_ALLOWED');
  });
});

describe('staff decision and appeal', () => {
  const review = { ...base, status: 'UNDER_REVIEW' as const };
  it('maps each outcome to the order event and counts lost disputes', () => {
    const r = (outcome: never, refundCents?: number, sellerAtFault = true) =>
      disputeStep(review, { type: 'RESOLVE', outcome, refundCents, sellerAtFault }, 'SUPPORT', now);
    expect(r('REFUND_FULL' as never)).toMatchObject({
      status: 'RESOLVED',
      orderEvent: { type: 'RESOLVED_FULL_REFUND' },
      countDisputeLost: true,
    });
    expect(r('REFUND_FULL_WITH_RETURN' as never)).toMatchObject({
      status: 'AWAITING_RETURN',
      orderEvent: { type: 'RETURN_REQUIRED' },
    });
    expect(r('REFUND_PARTIAL' as never, 2500, false)).toMatchObject({
      patch: { resolvedRefundCents: 2500 },
      countDisputeLost: false,
    });
    expect(r('RELEASE_TO_SELLER' as never)).toMatchObject({
      orderEvent: { type: 'RESOLVED_RELEASE' },
      countDisputeLost: false,
    });
    expect(err(() => r('REFUND_PARTIAL' as never, 0))).toBe('REFUND_OUT_OF_RANGE');
  });
  it('after a contested return only full refund or release are possible', () => {
    const ret = { ...review, orderStatus: 'RETURN_IN_TRANSIT' as const };
    const r = (outcome: never) =>
      disputeStep(ret, { type: 'RESOLVE', outcome, sellerAtFault: false }, 'SUPPORT', now);
    expect(r('REFUND_FULL' as never).orderEvent).toEqual({ type: 'RETURN_ACCEPTED' });
    expect(r('RELEASE_TO_SELLER' as never).orderEvent).toEqual({ type: 'RETURN_NOT_SHIPPED' });
    expect(err(() => r('REFUND_PARTIAL' as never))).toBe('OUTCOME_NOT_AVAILABLE');
  });
  it('one appeal within 7 days, reviewed by another staff member', () => {
    const done = { ...base, status: 'RESOLVED' as const, resolvedAt: now, resolvedById: 'staff-1' };
    const appealed = disputeStep(
      done,
      { type: 'APPEAL' },
      'SELLER',
      new Date(now.getTime() + 86_400_000),
    );
    expect(appealed.patch.appealedAt).toBeDefined();
    expect(
      err(() =>
        disputeStep(done, { type: 'APPEAL' }, 'BUYER', new Date(now.getTime() + 8 * 86_400_000)),
      ),
    ).toBe('APPEAL_WINDOW_CLOSED');
    const pending = { ...done, appealedAt: now };
    expect(err(() => disputeStep(pending, { type: 'APPEAL' }, 'BUYER', now))).toBe(
      'ALREADY_APPEALED',
    );
    expect(
      err(() =>
        disputeStep(pending, { type: 'APPEAL_DECISION', upheld: true }, 'SUPPORT', now, 'staff-1'),
      ),
    ).toBe('SAME_REVIEWER');
    expect(
      disputeStep(pending, { type: 'APPEAL_DECISION', upheld: false }, 'SUPPORT', now, 'staff-2')
        .patch,
    ).toMatchObject({ appealUpheld: false });
    expect(
      err(() =>
        disputeStep(done, { type: 'APPEAL_DECISION', upheld: true }, 'SUPPORT', now, 'staff-2'),
      ),
    ).toBe('NO_PENDING_APPEAL');
  });
});
