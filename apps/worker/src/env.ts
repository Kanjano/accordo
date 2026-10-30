import { z } from 'zod';

/** Worker environment (ADR-0024: the worker shares code with the API only through packages/*). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_URL: z.url(),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  MEILI_HOST: z.url(),
  MEILI_MASTER_KEY: z.string().min(16),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_PUBLIC: z.string().min(3),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  EMAIL_PROVIDER: z.enum(['smtp']).default('smtp'),
  EMAIL_FROM: z.string().min(3),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEARTBEAT_EVERY_MS: z.coerce.number().int().positive().default(30_000),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
