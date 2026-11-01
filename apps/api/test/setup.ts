import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type OutgoingEmail,
} from '../src/modules/notifications/email.provider.js';

export const WEB = 'http://localhost:3000';

/** Captures outgoing emails instead of sending them. */
export class FakeEmailProvider implements EmailProvider {
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
  }
  last(to: string): OutgoingEmail | undefined {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}

export interface TestEnv {
  app: INestApplication;
  emails: FakeEmailProvider;
  /** Only with `{ search: true }`. */
  meili?: StartedTestContainer;
  stop: () => Promise<void>;
}

export const MEILI_KEY = 'test_master_key_123456';

/**
 * Real PostgreSQL 18 + Valkey (+ Meilisearch on request) containers, migrated schema, full Nest
 * app with the production wiring. Without Meilisearch the API runs in degraded search mode.
 */
export async function startTestApp(
  opts: { search?: boolean; env?: Record<string, string> } = {},
): Promise<TestEnv> {
  const [pg, valkey, meili]: [
    StartedPostgreSqlContainer,
    StartedTestContainer,
    StartedTestContainer | undefined,
  ] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new GenericContainer('valkey/valkey:8.1.11-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
    opts.search
      ? new GenericContainer('getmeili/meilisearch:v1.56.0')
          .withEnvironment({ MEILI_MASTER_KEY: MEILI_KEY, MEILI_NO_ANALYTICS: 'true' })
          .withExposedPorts(7700)
          .withWaitStrategy(Wait.forHttp('/health', 7700))
          .start()
      : undefined,
  ]);
  const databaseUrl = pg.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '../../../packages/db'),
    env: { ...process.env, DATABASE_MIGRATION_URL: databaseUrl, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    WEB_URL: WEB,
    API_URL: 'http://localhost:4000',
    BETTER_AUTH_URL: 'http://localhost:4000',
    DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
    MEILI_HOST: meili
      ? `http://${meili.getHost()}:${meili.getMappedPort(7700)}`
      : 'http://127.0.0.1:9',
    MEILI_MASTER_KEY: MEILI_KEY,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'x',
    S3_SECRET_ACCESS_KEY: 'x',
    S3_BUCKET_PUBLIC: 'test-public',
    S3_BUCKET_PRIVATE: 'test-private',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
    DEVICE_COOKIE_SECRET: 'device-secret-'.repeat(3),
    TURNSTILE_SECRET_KEY: '',
    RATE_LIMIT_ENABLED: 'false',
    EMAIL_FROM: 'Accordo <no-reply@accordo.test>',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    LOG_LEVEL: 'error',
    PAYMENT_PROVIDER: 'fake',
    STRIPE_WEBHOOK_SECRET: 'test-webhook-secret',
    HANDOVER_CODE_PEPPER: 'test-handover-pepper',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SHIPPING_PROVIDER: 'mock',
    SHIPPING_WEBHOOK_SECRET: 'test-shipping-secret',
    ...opts.env,
  });

  const emails = new FakeEmailProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(emails)
    .compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    emails,
    meili,
    stop: async () => {
      await app.close();
      await Promise.all([pg.stop(), valkey.stop(), meili?.stop().catch(() => undefined)]);
    },
  };
}

/** Signs up, follows the verification link (auto sign-in) and returns a cookie-keeping agent. */
export function verifiedUserFactory(env: TestEnv) {
  return async (username: string) => {
    const agent = request.agent(env.app.getHttpServer());
    const email = `${username}@example.test`;
    await agent
      .post('/api/auth/sign-up/email')
      .set('origin', WEB)
      .send({
        name: 'Test User',
        username,
        email,
        password: 'una-password-lunga',
        acceptTerms: true,
      })
      .expect(200);
    const link = /href="(http:\/\/localhost:4000[^"]+)"/
      .exec(env.emails.last(email)?.html ?? '')?.[1]
      ?.replace(/&amp;/g, '&');
    if (!link) throw new Error('verification email not sent');
    await agent.get(new URL(link).pathname + new URL(link).search).expect(302);
    return { agent, email };
  };
}
