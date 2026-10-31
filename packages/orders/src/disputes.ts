import type { Prisma } from '@accordo/db';
import {
  type DisputeAction,
  type DisputeActor,
  type DisputeStatus,
  disputeStep,
  type NextAction,
  type OrderStatus,
  sweeperStep,
} from '@accordo/domain';
import { type Actor, applyOrderEvent, OrderConflictError, snapshot } from './engine.js';

type Tx = Prisma.TransactionClient;
type OrderRow = Prisma.OrderGetPayload<object>;

/** Who hears about each dispute step (texts in the worker's templates). */
const NOTICE: Record<
  DisputeAction['type'],
  { template: string; to: Array<'BUYER' | 'SELLER' | 'SUPPORT'> }
> = {
  SELLER_RESPOND: { template: 'dispute.seller_responded', to: ['BUYER'] },
  ACCEPT_PROPOSAL: { template: 'dispute.proposal_accepted', to: ['SELLER'] },
  ESCALATE: { template: 'dispute.escalated', to: ['BUYER', 'SELLER', 'SUPPORT'] },
  DEADLINE: { template: 'dispute.escalated', to: ['BUYER', 'SELLER', 'SUPPORT'] },
  WITHDRAW: { template: 'dispute.withdrawn', to: ['SELLER'] },
  RESOLVE: { template: 'dispute.resolved', to: ['BUYER', 'SELLER'] },
  APPEAL: { template: 'dispute.appealed', to: ['BUYER', 'SELLER', 'SUPPORT'] },
  APPEAL_DECISION: { template: 'dispute.appeal_decided', to: ['BUYER', 'SELLER'] },
};

export interface DisputeOptions {
  handoverPepper: string;
  /** Message added to the dispute thread (motivation, proposal note…). */
  message?: string;
  /** Written motivation of a staff decision (SPEC §6.6), sent to both parties. */
  notes?: string;
  now?: Date;
}

/**
 * Applies a dispute action (domain `disputeStep`) atomically: dispute row (guarded on its status),
 * thread message, order event through the order state machine (money moves there), order timer,
 * lost-dispute counter and notifications.
 */
export async function applyDisputeAction(
  tx: Tx,
  disputeId: string,
  action: DisputeAction,
  actor: Actor,
  opts: DisputeOptions,
) {
  const now = opts.now ?? new Date();
  const d = await tx.dispute.findUniqueOrThrow({
    where: { id: disputeId },
    include: { order: true },
  });
  const returned = await tx.shipment.findFirst({
    where: { orderId: d.orderId, direction: 'RETURN', status: 'DELIVERED' },
    select: { id: true },
  });
  const step = disputeStep(
    {
      status: d.status as DisputeStatus,
      proposedRefundCents: d.proposedRefundCents,
      resolvedAt: d.resolvedAt,
      resolvedById: d.resolvedById,
      appealedAt: d.appealedAt,
      appealResolvedAt: d.appealResolvedAt,
      orderStatus: d.order.status as OrderStatus,
      itemPriceCents: d.order.itemPriceCents,
      returnDelivered: !!returned,
    },
    action,
    actor.role as DisputeActor,
    now,
    actor.id ?? undefined,
  );
  const { appealUpheld, ...patch } = step.patch;
  const { count } = await tx.dispute.updateMany({
    where: { id: d.id, status: d.status },
    data: {
      ...patch,
      status: step.status,
      ...(action.type === 'SELLER_RESPOND' && action.response === 'ACCEPT_REFUND'
        ? { resolvedRefundCents: d.order.totalCents }
        : {}),
      ...(action.type === 'RESOLVE'
        ? {
            resolvedById: actor.id,
            resolutionNotes: opts.notes ?? null,
            sellerAtFault: action.sellerAtFault,
          }
        : {}),
      // Accepting a refund is the seller acknowledging the problem (return label on them).
      ...(action.type === 'SELLER_RESPOND' && action.response.startsWith('ACCEPT')
        ? { sellerAtFault: true }
        : {}),
      ...(action.type === 'APPEAL_DECISION'
        ? { appealResolvedById: actor.id, appealUpheld, appealNotes: opts.notes ?? null }
        : {}),
    },
  });
  if (!count) throw new OrderConflictError(`Dispute ${d.id} changed concurrently`);
  const text = opts.notes ?? opts.message;
  if (text)
    await tx.disputeMessage.create({
      data: { disputeId: d.id, authorId: actor.id, authorRole: actor.role, body: text },
    });

  if (step.orderEvent) {
    await applyOrderEvent(tx, d.orderId, step.orderEvent, actor, {
      handoverPepper: opts.handoverPepper,
      reason: `dispute:${action.type}`,
      now,
    });
  } else if (step.orderTimer !== undefined) {
    await setOrderTimer(tx, d.order, step.orderTimer);
  }
  if (step.countDisputeLost)
    await tx.userReputation.upsert({
      where: { userId: d.order.sellerId },
      create: { userId: d.order.sellerId, disputesLost12m: 1 },
      update: { disputesLost12m: { increment: 1 } },
    });
  const notice = NOTICE[action.type];
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'Order',
      aggregateId: d.orderId,
      type: 'order.effects',
      payload: {
        orderId: d.orderId,
        eventId: `dispute:${d.id}:${action.type}:${now.getTime()}`,
        effects: [{ type: 'NOTIFY', template: notice.template, to: notice.to }],
      },
    },
  });
  return tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
}

async function setOrderTimer(
  tx: Tx,
  order: OrderRow,
  timer: { action: NextAction; at: Date } | null,
) {
  const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
  const { count } = await tx.order.updateMany({
    where: { id: order.id, version: current.version },
    data: {
      nextAction: timer?.action ?? null,
      nextActionAt: timer?.at ?? null,
      version: { increment: 1 },
    },
  });
  if (!count) throw new OrderConflictError(`Order ${order.id} changed concurrently`);
}

/**
 * Runs the due `nextAction` of an order (SPEC §6.4): order events, reminders and dispute
 * deadlines. Used by the worker's sweeper and by the development "run timer" endpoint.
 */
export async function runDueAction(
  tx: Tx,
  order: OrderRow,
  now: Date,
  handoverPepper: string,
): Promise<'event' | 'reminder' | 'dispute' | 'parked'> {
  const action = order.nextAction as NextAction;
  const system = { role: 'SYSTEM' as const, id: null };
  if (action === 'DISPUTE_SELLER_DEADLINE' || action === 'DISPUTE_BUYER_DEADLINE') {
    const d = await tx.dispute.findFirst({
      where: { orderId: order.id, status: { in: ['OPEN', 'AWAITING_BUYER'] } },
    });
    if (!d) {
      await tx.order.update({ where: { id: order.id }, data: { nextActionAt: null } });
      return 'parked';
    }
    await applyDisputeAction(tx, d.id, { type: 'DEADLINE' }, system, { handoverPepper, now });
    return 'dispute';
  }
  const step = sweeperStep(action, snapshot(order));
  if (!step) {
    await tx.order.update({ where: { id: order.id }, data: { nextActionAt: null } });
    return 'parked';
  }
  if (step.kind === 'event') {
    await applyOrderEvent(tx, order.id, step.event, system, { handoverPepper, now });
    return 'event';
  }
  const { count } = await tx.order.updateMany({
    where: { id: order.id, version: order.version },
    data: {
      nextAction: step.timer?.action ?? null,
      nextActionAt: step.timer?.at ?? null,
      version: { increment: 1 },
    },
  });
  if (!count) throw new OrderConflictError(order.id);
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'Order',
      aggregateId: order.id,
      type: 'order.effects',
      payload: {
        orderId: order.id,
        eventId: `${order.nextAction}:${order.version}`,
        effects: step.effects as unknown as Prisma.InputJsonValue,
      },
    },
  });
  return 'reminder';
}
