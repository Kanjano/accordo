import type { PrismaClient } from '@accordo/db';
import { type NextAction, OrderTransitionError, sweeperStep } from '@accordo/domain';
import { applyOrderEvent, OrderConflictError, snapshot } from '@accordo/orders';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../infra.js';
import { Notifier } from '../notifications/notifier.js';
import { QUEUES } from '../queues.js';

const DAY = 86_400_000;

@Injectable()
export class OrdersScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.orders) private readonly orders: Queue,
    @InjectQueue(QUEUES.nightly) private readonly nightly: Queue,
  ) {}

  async onApplicationBootstrap() {
    await this.orders.upsertJobScheduler('order-sweeper', { every: 60_000 }, { name: 'sweep' });
    await this.nightly.upsertJobScheduler(
      'nightly-checks',
      { pattern: '30 3 * * *', tz: 'Europe/Rome' },
      { name: 'run' },
    );
  }
}

/** SPEC §5.7 `order-sweeper`: runs the due `nextAction` of each order through the state machine. */
@Processor(QUEUES.orders)
export class OrdersSweeper extends WorkerHost {
  private readonly logger = new Logger(OrdersSweeper.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  process() {
    return this.run(new Date());
  }

  async run(now: Date): Promise<{ handled: number }> {
    const due = await this.db.order.findMany({
      where: { nextActionAt: { lte: now }, nextAction: { not: null } },
      orderBy: { nextActionAt: 'asc' },
      take: 200,
    });
    let handled = 0;
    for (const order of due) {
      const step = sweeperStep(order.nextAction as NextAction, snapshot(order));
      try {
        await this.db.$transaction(async (tx) => {
          if (!step) {
            // Dispute deadlines arrive with Phase 8: park the timer instead of looping on it.
            await tx.order.update({ where: { id: order.id }, data: { nextActionAt: null } });
          } else if (step.kind === 'event') {
            await applyOrderEvent(
              tx,
              order.id,
              step.event,
              { role: 'SYSTEM', id: null },
              {
                handoverPepper: this.env.HANDOVER_CODE_PEPPER,
                now,
              },
            );
          } else {
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
                  effects: step.effects as object[],
                },
              },
            });
          }
        });
        handled++;
      } catch (e) {
        if (e instanceof OrderConflictError) continue; // changed meanwhile: next run
        if (e instanceof OrderTransitionError) {
          this.logger.warn(`Order ${order.number}: ${e.message}; timer cleared`);
          await this.db.order.update({ where: { id: order.id }, data: { nextActionAt: null } });
          continue;
        }
        throw e;
      }
    }
    if (handled) this.logger.log(`order sweeper: ${handled} timers`);
    return { handled };
  }
}

export interface NightlyReport {
  unbalancedTransactions: number;
  closedOrdersWithPayable: number;
  heldOver60Days: number;
  heldOver85Days: number;
}

/**
 * Nightly (SPEC §6.9, §6.10, §6.1.5): ledger invariants and funds held too long. With Stripe the
 * comparison with the balance transactions joins here (ADR-0040); alerts go to the admins.
 */
@Processor(QUEUES.nightly)
export class NightlyChecks extends WorkerHost {
  private readonly logger = new Logger(NightlyChecks.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  process() {
    return this.run(new Date());
  }

  async run(now: Date): Promise<NightlyReport> {
    const [unbalanced] = await this.db.$queryRaw<[{ n: bigint }]>`
      SELECT count(*) AS n FROM (
        SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId"
        HAVING sum(CASE WHEN direction = 'DEBIT' THEN "amountCents" ELSE 0 END)
            <> sum(CASE WHEN direction = 'CREDIT' THEN "amountCents" ELSE 0 END)
      ) t`;
    // Closed = nothing more will move: refunded/cancelled, or completed and transferred.
    const [payable] = await this.db.$queryRaw<[{ n: bigint }]>`
      SELECT count(*) AS n FROM (
        SELECT o.id FROM "Order" o
        JOIN "LedgerTransaction" t ON t."orderId" = o.id
        JOIN "LedgerEntry" e ON e."transactionId" = t.id AND e.account = 'SELLER_PAYABLE'
        WHERE o.status IN ('REFUNDED', 'CANCELLED')
           OR (o.status = 'COMPLETED' AND o."payoutStatus" = 'TRANSFERRED')
        GROUP BY o.id
        HAVING sum(CASE WHEN e.direction = 'CREDIT' THEN e."amountCents" ELSE -e."amountCents" END) <> 0
      ) t`;
    const open = {
      notIn: ['COMPLETED', 'REFUNDED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED'] as never[],
    };
    const [over60, over85] = await Promise.all([
      this.db.order.findMany({
        where: { status: open, paidAt: { lte: new Date(now.getTime() - 60 * DAY) } },
        select: { number: true },
      }),
      this.db.order.count({
        where: { status: open, paidAt: { lte: new Date(now.getTime() - 85 * DAY) } },
      }),
    ]);
    const report: NightlyReport = {
      unbalancedTransactions: Number(unbalanced.n),
      closedOrdersWithPayable: Number(payable.n),
      heldOver60Days: over60.length,
      heldOver85Days: over85,
    };
    if (Object.values(report).some((v) => v > 0)) {
      this.logger.error(`ALERT nightly checks: ${JSON.stringify(report)}`);
      const admins = await this.db.user.findMany({
        where: { role: 'admin' },
        select: { id: true },
      });
      for (const a of admins)
        await this.notifier.notify({
          userId: a.id,
          preference: 'security.alerts',
          mandatory: true,
          type: 'admin.nightly_alert',
          title: 'Controlli notturni: anomalie',
          body: `Transazioni sbilanciate: ${report.unbalancedTransactions}; ordini chiusi con saldo venditore: ${report.closedOrdersWithPayable}; fondi trattenuti oltre 60 giorni: ${report.heldOver60Days} (${over60
            .map((o) => o.number)
            .slice(0, 10)
            .join(', ')}); oltre 85 giorni: ${report.heldOver85Days}.`,
          path: '/admin/ordini',
        });
    }
    return report;
  }
}
