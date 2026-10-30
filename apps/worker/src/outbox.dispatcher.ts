import type { PrismaClient } from '@accordo/db';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ENV, type Env } from './env.js';
import { PRISMA } from './infra.js';
import { QUEUES, routesFor } from './queues.js';

interface Row {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

const MAX_ATTEMPTS = 10;

/**
 * Transactional outbox → BullMQ (SPEC §5.4). Rows are claimed with FOR UPDATE SKIP LOCKED, so
 * several workers can run; the outbox id is the BullMQ jobId, so a re-dispatch never duplicates a job.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly queues: Record<string, Queue>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @InjectQueue(QUEUES.media) media: Queue,
    @InjectQueue(QUEUES.notifications) notifications: Queue,
    @InjectQueue(QUEUES.searchIndex) searchIndex: Queue,
  ) {
    this.queues = {
      [QUEUES.media]: media,
      [QUEUES.notifications]: notifications,
      [QUEUES.searchIndex]: searchIndex,
    };
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), this.env.OUTBOX_POLL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Dispatches one batch; returns the number of rows handled. */
  async tick(batch = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Row[]>`
          SELECT id, type, payload, attempts FROM "OutboxEvent"
          WHERE status = 'PENDING' AND "availableAt" <= now()
          ORDER BY "createdAt" LIMIT ${batch}
          FOR UPDATE SKIP LOCKED`;
        for (const row of rows) {
          try {
            for (const name of routesFor(row.type)) {
              await this.queues[name]?.add(row.type, row.payload, {
                jobId: row.id,
                attempts: 5,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: 1000,
                removeOnFail: 5000,
              });
            }
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'PROCESSED', processedAt: new Date() },
            });
          } catch (e) {
            const attempts = row.attempts + 1;
            this.logger.error(
              `Outbox ${row.type} ${row.id} failed (attempt ${attempts}): ${String(e)}`,
            );
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: String(e).slice(0, 1000),
                status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
                availableAt: new Date(Date.now() + 2 ** attempts * 1000),
              },
            });
          }
        }
        return rows.length;
      });
    } finally {
      this.running = false;
    }
  }
}
