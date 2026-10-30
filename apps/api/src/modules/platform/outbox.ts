import type { Prisma } from '@accordo/db';

export interface OutboxInput {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Golden rule (SPEC §5.4): effects outside the database are written to the outbox in the same
 * transaction as the state change; the worker dispatcher publishes them to the queues.
 */
export function writeOutbox(tx: Prisma.TransactionClient, ...events: OutboxInput[]) {
  return tx.outboxEvent.createMany({ data: events });
}
