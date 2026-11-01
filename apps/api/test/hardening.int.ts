import type { PrismaClient } from '@accordo/db';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { signNotMeToken } from '../src/modules/auth/not-me.js';
import { PRISMA, REDIS } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let redis: Redis;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;

beforeAll(async () => {
  env = await startTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
  db = env.app.get(PRISMA);
  redis = env.app.get(REDIS);
  verifiedUser = verifiedUserFactory(env);
});
afterAll(() => env?.stop());

/** Clears the per-IP Better Auth windows (every test request comes from the same address). */
async function resetIpLimits() {
  const keys = await redis.keys('ba-rl:*');
  if (keys.length) await redis.del(...keys);
}

const signIn = (email: string, password: string) =>
  request(env.app.getHttpServer())
    .post('/api/auth/sign-in/email')
    .set('origin', WEB)
    .send({ email, password });

describe('hardening (SPEC §13)', () => {
  it('API responses carry the security headers', async () => {
    const res = await request(env.app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sign-in: 5 per minute per IP, then 10 per hour per account before Turnstile', async () => {
    await resetIpLimits();
    const { email } = await verifiedUser('limitato');
    await resetIpLimits();
    for (let i = 0; i < 5; i++) expect((await signIn(email, 'sbagliata-123')).status).toBe(401);
    expect((await signIn(email, 'sbagliata-123')).status).toBe(429);

    // From "other addresses" the account limit still counts: 5 + 5 attempts, then even the right
    // password needs the Turnstile check.
    await resetIpLimits();
    for (let i = 0; i < 5; i++) expect((await signIn(email, 'sbagliata-123')).status).toBe(401);
    await resetIpLimits();
    const blocked = await signIn(email, 'una-password-lunga');
    expect([blocked.status, blocked.body.code]).toEqual([429, 'CAPTCHA_REQUIRED']);
  });

  it('"Non sono stato io" signs out every device, disables the password and emails a reset link', async () => {
    await resetIpLimits();
    const { agent, email } = await verifiedUser('derubato');
    await agent.get('/api/v1/me').expect(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });

    const bad = await request(env.app.getHttpServer())
      .post('/api/v1/auth/not-me')
      .set('origin', WEB)
      .send({ token: `${user.id}.9999999999999.forged` });
    expect([bad.status, bad.body.code]).toEqual([400, 'INVALID_LINK']);

    await request(env.app.getHttpServer())
      .post('/api/v1/auth/not-me')
      .set('origin', WEB)
      .send({ token: signNotMeToken(process.env.BETTER_AUTH_SECRET as string, user.id) })
      .expect(204);
    await agent.get('/api/v1/me').expect(401);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    await resetIpLimits();
    expect((await signIn(email, 'una-password-lunga')).status).toBe(401);
    expect(env.emails.last(email)?.subject).toBe('Reimposta la password di Accordo');
    expect(await db.auditLog.count({ where: { action: 'user.not_me', entityId: user.id } })).toBe(
      1,
    );
  });

  it('audit rows are purged only past retention, through the dedicated function', async () => {
    const old = await db.auditLog.create({
      data: {
        action: 'test.old',
        entityType: 'Test',
        createdAt: new Date(Date.now() - 3 * 365 * 86_400_000),
      },
    });
    const recent = await db.auditLog.create({
      data: { action: 'test.recent', entityType: 'Test' },
    });
    await expect(db.auditLog.delete({ where: { id: recent.id } })).rejects.toThrow();
    const [{ n }] = await db.$queryRaw<[{ n: number }]>`
      SELECT purge_audit_log(${new Date(Date.now() - 25 * 30 * 86_400_000)}) AS n`;
    expect(n).toBe(1);
    expect(await db.auditLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
