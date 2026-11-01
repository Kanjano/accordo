import { writeFile } from 'node:fs/promises';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ENV, type Env } from './env.js';

export const HEARTBEAT_QUEUE = 'heartbeat';

/** Registers the repeatable heartbeat job (idempotent: same scheduler id on every boot). */
@Injectable()
export class HeartbeatScheduler implements OnApplicationBootstrap {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(HEARTBEAT_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'worker-heartbeat',
      { every: this.env.HEARTBEAT_EVERY_MS },
      { name: 'beat' },
    );
  }
}

@Processor(HEARTBEAT_QUEUE)
export class HeartbeatProcessor extends WorkerHost {
  private readonly logger = new Logger(HeartbeatProcessor.name);

  async process(): Promise<{ at: string }> {
    const at = new Date().toISOString();
    this.logger.log(`heartbeat ${at}`);
    // Read by the container HEALTHCHECK (Dockerfile): the worker is alive *and* processing jobs.
    await writeFile('/tmp/worker-heartbeat', at).catch(() => undefined);
    return { at };
  }
}
