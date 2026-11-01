import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

/**
 * Environment contract. The API refuses to start when this fails.
 * ponytail: only variables used so far; each phase adds the ones it consumes (see docs/DECISIONS.md).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_URL: z.url(),
  API_URL: z.url(),
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
  COOKIE_DOMAIN: z.string().min(1).default('localhost'),
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  DEVICE_COOKIE_SECRET: secret,
  STEP_UP_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(10),
  TURNSTILE_SECRET_KEY: z.string().optional().default(''),
  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  EMAIL_PROVIDER: z.enum(['smtp']).default('smtp'),
  EMAIL_FROM: z.string().min(3),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  PAYMENT_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  HANDOVER_CODE_PEPPER: z.string().min(8),
  /** AES-256-GCM key for tax data (SPEC §10.3): 32 random bytes, base64. */
  ENCRYPTION_KEY: z
    .base64('ENCRYPTION_KEY must be base64')
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes'),
  ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[a-z0-9]{1,8}$/)
    .default('k1'),
  SHIPPING_PROVIDER: z.enum(['mock', 'sendcloud']).default('mock'),
  SHIPPING_API_KEY: z.string().optional().default(''),
  SHIPPING_API_SECRET: z.string().optional().default(''),
  SHIPPING_WEBHOOK_SECRET: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
