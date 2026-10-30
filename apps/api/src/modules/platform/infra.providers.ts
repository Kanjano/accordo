import { S3Client } from '@aws-sdk/client-s3';
import type { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import { ENV, type Env } from '../../config/env.js';

export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');
export const S3 = Symbol('S3');

// ponytail: raw pg pool only for readiness until Prisma lands in Phase 1.
export const infraProviders: Provider[] = [
  {
    provide: PG_POOL,
    inject: [ENV],
    useFactory: (env: Env) =>
      new pg.Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 2000 }),
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
];
