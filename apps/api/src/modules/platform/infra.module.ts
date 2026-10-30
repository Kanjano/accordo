import type { PrismaClient } from '@accordo/db';
import type { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { infraProviders, PRISMA, REDIS, S3 } from './infra.providers.js';
import { RateLimitService } from './rate-limit.service.js';
import { SettingsService } from './settings.service.js';

/** Shared clients (PostgreSQL via Prisma, Valkey, S3) for every module. */
@Global()
@Module({
  providers: [...infraProviders, RateLimitService, SettingsService],
  exports: [PRISMA, REDIS, S3, RateLimitService, SettingsService],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
    this.redis.disconnect();
    this.s3.destroy();
  }
}
