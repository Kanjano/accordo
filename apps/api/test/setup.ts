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
  stop: () => Promise<void>;
}

/** Real PostgreSQL 18 + Valkey containers, migrated schema, full Nest app with the production wiring. */
export async function startTestApp(): Promise<TestEnv> {
  const [pg, valkey]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new GenericContainer('valkey/valkey:8.1.11-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
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
    MEILI_HOST: 'http://localhost:7700',
    MEILI_MASTER_KEY: 'test_master_key_123456',
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
    stop: async () => {
      await app.close();
      await Promise.all([pg.stop(), valkey.stop()]);
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
