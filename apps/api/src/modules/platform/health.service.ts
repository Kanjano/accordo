import type { PrismaClient } from '@accordo/db';
import type { HealthReport } from '@accordo/shared';
import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, REDIS, S3 } from './infra.providers.js';

const TIMEOUT_MS = 2500;

function withTimeout(p: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS).unref(),
    ),
  ]);
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async readiness(): Promise<HealthReport> {
    const checks: Record<string, () => Promise<unknown>> = {
      database: () => this.db.$queryRaw`SELECT 1`,
      valkey: async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        await this.redis.ping();
      },
      meilisearch: async () => {
        const res = await fetch(new URL('/health', this.env.MEILI_HOST));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      storage: () =>
        Promise.all(
          [this.env.S3_BUCKET_PUBLIC, this.env.S3_BUCKET_PRIVATE].map((Bucket) =>
            this.s3.send(new HeadBucketCommand({ Bucket })),
          ),
        ),
    };
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check());
          return [name, { status: 'up' as const }] as const;
        } catch (e) {
          return [
            name,
            { status: 'down' as const, error: e instanceof Error ? e.message : String(e) },
          ] as const;
        }
      }),
    );
    const report = Object.fromEntries(entries);
    return {
      status: entries.every(([, c]) => c.status === 'up') ? 'ok' : 'error',
      checks: report,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
    this.redis.disconnect();
    this.s3.destroy();
  }
}
