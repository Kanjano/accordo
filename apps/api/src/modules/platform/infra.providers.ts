import { createPrismaClient } from '@accordo/db';
import { createSearchClient } from '@accordo/search';
import { S3Client } from '@aws-sdk/client-s3';
import type { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';

export const PRISMA = Symbol('PRISMA');
export const REDIS = Symbol('REDIS');
export const S3 = Symbol('S3');
export const SEARCH = Symbol('SEARCH');

export const infraProviders: Provider[] = [
  {
    provide: PRISMA,
    inject: [ENV],
    useFactory: (env: Env) => createPrismaClient(env.DATABASE_URL),
  },
  {
    provide: REDIS,
    inject: [ENV],
    useFactory: (env: Env) =>
      new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      }),
  },
  {
    provide: S3,
    inject: [ENV],
    useFactory: (env: Env) =>
      new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
      }),
  },
  {
    provide: SEARCH,
    inject: [ENV],
    // Short timeout: a hung Meilisearch must fall back to PostgreSQL quickly (SPEC §9.3).
    useFactory: (env: Env) => createSearchClient(env.MEILI_HOST, env.MEILI_MASTER_KEY, 1500),
  },
];
