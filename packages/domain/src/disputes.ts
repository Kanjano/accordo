import type { DisputeReason, NextAction, OrderEvent, OrderStatus } from './order-state-machine.js';

export type DisputeStatus =
  | 'OPEN'
  | 'AWAITING_BUYER'
  | 'UNDER_REVIEW'
  | 'AWAITING_RETURN'
  | 'RESOLVED'
  | 'WITHDRAWN';
export type DisputeOutcome =
  | 'REFUND_FULL'
  | 'REFUND_FULL_WITH_RETURN'
  | 'REFUND_PARTIAL'
  | 'RELEASE_TO_SELLER';
export type SellerResponse =
  | 'ACCEPT_REFUND_WITH_RETURN'
  | 'ACCEPT_REFUND'
  | 'PROPOSE_PARTIAL'
  | 'REJECT';

export type DisputeAction =
  | { type: 'SELLER_RESPOND'; response: SellerResponse; amountCents?: number }
  | { type: 'ACCEPT_PROPOSAL' }
  | { type: 'ESCALATE' }
  | { type: 'WITHDRAW' }
  | { type: 'DEADLINE' }
  | { type: 'RESOLVE'; outcome: DisputeOutcome; refundCents?: number; sellerAtFault: boolean }
  | { type: 'APPEAL' }
  | { type: 'APPEAL_DECISION'; upheld: boolean };

export type DisputeActor = 'BUYER' | 'SELLER' | 'SUPPORT' | 'SYSTEM';

export interface DisputeSnapshot {
  status: DisputeStatus;
  proposedRefundCents: number | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  appealedAt: Date | null;
  appealResolvedAt: Date | null;
  orderStatus: OrderStatus;
  itemPriceCents: number;
  /** The return parcel reached the seller (48 h to contest it, SPEC §6.6). */
  returnDelivered: boolean;
}

export interface DisputeStep {
  status: DisputeStatus;
  patch: Partial<{
    outcome: DisputeOutcome;
    proposedRefundCents: number;
    resolvedRefundCents: number;
    escalatedAt: Date;
    resolvedAt: Date;
    appealedAt: Date;
    appealResolvedAt: Date;
    appealUpheld: boolean;
    buyerResponseDueAt: Date | null;
  }>;
  /** Event applied to the order (money moves through the order state machine). */
  orderEvent?: OrderEvent;
  /** undefined: leave the order timer as it is; null: clear it. */
  orderTimer?: { action: NextAction; at: Date } | null;
  countDisputeLost?: boolean;
}

export class DisputeActionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DisputeActionError';
  }
}

export const DISPUTE_RESPONSE_HOURS = 72;
export const APPEAL_WINDOW_DAYS = 7;
const HOUR = 3_600_000;

/** Reasons that need at least 2 photos (SPEC §6.6). */
export const PHOTO_REASONS: readonly DisputeReason[] = [
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'INCOMPLETE',
  'COUNTERFEIT',
];

export function disputeOpeningError(i: {
  reason: DisputeReason;
  description: string;
  photos: number;
}): 'DESCRIPTION_TOO_SHORT' | 'PHOTOS_REQUIRED' | null {
  if (i.description.trim().length < 30) return 'DESCRIPTION_TOO_SHORT';
  if (PHOTO_REASONS.includes(i.reason) && i.photos < 2) return 'PHOTOS_REQUIRED';
  return null;
}

/** Order event that carries a decision into the order state machine. */
function orderEventFor(
  d: DisputeSnapshot,
  outcome: DisputeOutcome,
  refundCents?: number,
): OrderEvent {
  if (d.orderStatus === 'RETURN_IN_TRANSIT') {
    // After the return: refund it, or the seller keeps the payment.
    if (outcome === 'REFUND_FULL') return { type: 'RETURN_ACCEPTED' };
    if (outcome === 'RELEASE_TO_SELLER') return { type: 'RETURN_NOT_SHIPPED' };
    throw new DisputeActionError('OUTCOME_NOT_AVAILABLE');
  }
  switch (outcome) {
    case 'REFUND_FULL':
      return { type: 'RESOLVED_FULL_REFUND' };
    case 'REFUND_FULL_WITH_RETURN':
      return { type: 'RETURN_REQUIRED' };
    case 'RELEASE_TO_SELLER':
      return { type: 'RESOLVED_RELEASE' };
    case 'REFUND_PARTIAL': {
      if (
        !refundCents ||
        !Number.isSafeInteger(refundCents) ||
        refundCents <= 0 ||
        refundCents > d.itemPriceCents
      )
        throw new DisputeActionError('REFUND_OUT_OF_RANGE');
      return { type: 'RESOLVED_PARTIAL_REFUND', refundCents };
    }
  }
}

/** SPEC §6.6 dispute procedure as a pure function: who may do what, and what follows. */
export function disputeStep(
  d: DisputeSnapshot,
  action: DisputeAction,
  actor: DisputeActor,
  now: Date,
  actorId?: string,
): DisputeStep {
  const fail = (code: string): never => {
    throw new DisputeActionError(code);
  };
  const only = (...roles: DisputeActor[]) => (roles.includes(actor) ? null : fail('NOT_ALLOWED'));
  const from = (...statuses: DisputeStatus[]) =>
    statuses.includes(d.status) ? null : fail('INVALID_DISPUTE_STATE');
  const resolved = (
    outcome: DisputeOutcome,
    extra: DisputeStep['patch'] = {},
  ): DisputeStep['patch'] => ({
    outcome,
    resolvedAt: now,
    ...extra,
  });

  switch (action.type) {
    case 'SELLER_RESPOND': {
      only('SELLER');
      from('OPEN');
      switch (action.response) {
        case 'ACCEPT_REFUND_WITH_RETURN':
          return {
            status: 'AWAITING_RETURN',
            patch: { outcome: 'REFUND_FULL_WITH_RETURN' },
            orderEvent: { type: 'RETURN_REQUIRED' },
          };
        case 'ACCEPT_REFUND':
          return {
            status: 'RESOLVED',
            patch: resolved('REFUND_FULL'),
            orderEvent: { type: 'RESOLVED_FULL_REFUND' },
          };
        case 'PROPOSE_PARTIAL': {
          const amount = action.amountCents ?? 0;
          if (!Number.isSafeInteger(amount) || amount <= 0 || amount > d.itemPriceCents)
            fail('REFUND_OUT_OF_RANGE');
          const due = new Date(now.getTime() + DISPUTE_RESPONSE_HOURS * HOUR);
          return {
            status: 'AWAITING_BUYER',
            patch: { proposedRefundCents: amount, buyerResponseDueAt: due },
            orderTimer: { action: 'DISPUTE_BUYER_DEADLINE', at: due },
          };
        }
        case 'REJECT':
          return { status: 'UNDER_REVIEW', patch: { escalatedAt: now }, orderTimer: null };
      }
      return fail('INVALID_RESPONSE');
    }
    case 'ACCEPT_PROPOSAL':
      only('BUYER');
      from('AWAITING_BUYER');
      return {
        status: 'RESOLVED',
        patch: resolved('REFUND_PARTIAL', {
          resolvedRefundCents: d.proposedRefundCents as number,
          buyerResponseDueAt: null,
        }),
        orderEvent: {
          type: 'RESOLVED_PARTIAL_REFUND',
          refundCents: d.proposedRefundCents as number,
        },
      };
    case 'ESCALATE':
      only('BUYER', 'SELLER');
      // After the return reached the seller, only the seller may contest its condition (48 h).
      if (d.status === 'AWAITING_RETURN') {
        if (actor !== 'SELLER' || !d.returnDelivered) fail('INVALID_DISPUTE_STATE');
      } else from('OPEN', 'AWAITING_BUYER');
      return { status: 'UNDER_REVIEW', patch: { escalatedAt: now }, orderTimer: null };
    case 'DEADLINE':
      only('SYSTEM');
      from('OPEN', 'AWAITING_BUYER');
      return { status: 'UNDER_REVIEW', patch: { escalatedAt: now }, orderTimer: null };
    case 'WITHDRAW':
      only('BUYER');
      from('OPEN', 'AWAITING_BUYER', 'UNDER_REVIEW');
      return {
        status: 'WITHDRAWN',
        patch: { resolvedAt: now, outcome: 'RELEASE_TO_SELLER' },
        orderEvent: { type: 'RESOLVED_RELEASE' },
      };
    case 'RESOLVE': {
      only('SUPPORT');
      from('UNDER_REVIEW');
      const orderEvent = orderEventFor(d, action.outcome, action.refundCents);
      const withReturn = action.outcome === 'REFUND_FULL_WITH_RETURN';
      return {
        status: withReturn ? 'AWAITING_RETURN' : 'RESOLVED',
        patch: withReturn
          ? { outcome: action.outcome }
          : resolved(action.outcome, {
              ...(action.outcome === 'REFUND_PARTIAL'
                ? { resolvedRefundCents: action.refundCents }
                : {}),
            }),
        orderEvent,
        countDisputeLost: action.sellerAtFault && action.outcome !== 'RELEASE_TO_SELLER',
      };
    }
    case 'APPEAL': {
      only('BUYER', 'SELLER');
      from('RESOLVED');
      if (d.appealedAt) fail('ALREADY_APPEALED');
      if (!d.resolvedAt || now.getTime() > d.resolvedAt.getTime() + APPEAL_WINDOW_DAYS * 24 * HOUR)
        fail('APPEAL_WINDOW_CLOSED');
      return { status: 'RESOLVED', patch: { appealedAt: now } };
    }
    case 'APPEAL_DECISION':
      only('SUPPORT');
      from('RESOLVED');
      if (!d.appealedAt || d.appealResolvedAt) fail('NO_PENDING_APPEAL');
      // Reviewed by another member of the staff (SPEC §6.6).
      if (actorId && actorId === d.resolvedById) fail('SAME_REVIEWER');
      return {
        status: 'RESOLVED',
        patch: { appealResolvedAt: now, appealUpheld: action.upheld },
      };
  }
}
