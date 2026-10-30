import type { PrismaClient } from '@accordo/db';
import request from 'supertest';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;

beforeAll(async () => {
  env = await startTestApp();
  db = env.app.get(PRISMA);
});
afterAll(() => env?.stop());

/** Signs up, follows the verification link (auto sign-in) and returns a cookie-keeping agent. */
async function verifiedUser(username: string) {
  const agent = request.agent(env.app.getHttpServer());
  const email = `${username}@example.test`;
  await agent
    .post('/api/auth/sign-up/email')
    .set('origin', WEB)
    .send({ name: 'Test User', username, email, password: 'una-password-lunga', acceptTerms: true })
    .expect(200);
  const link = /href="(http:\/\/localhost:4000[^"]+)"/
    .exec(env.emails.last(email)?.html ?? '')?.[1]
    ?.replace(/&amp;/g, '&');
  expect(link).toBeTruthy();
  await agent.get(new URL(link as string).pathname + new URL(link as string).search).expect(302);
  return { agent, email };
}

describe('sign-up', () => {
  it('requires accepting the terms', async () => {
    const res = await request(env.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('origin', WEB)
      .send({
        name: 'No Terms',
        username: 'noterms',
        email: 'noterms@example.test',
        password: 'una-password-lunga',
      });
    expect(res.status).toBe(400);
  });

  it('blocks unverified users from U endpoints', async () => {
    const agent = request.agent(env.app.getHttpServer());
    await agent.post('/api/auth/sign-up/email').set('origin', WEB).send({
      name: 'Unverified',
      username: 'unverified',
      email: 'unverified@example.test',
      password: 'una-password-lunga',
      acceptTerms: true,
    });
    await agent
      .post('/api/auth/sign-in/email')
      .set('origin', WEB)
      .send({ email: 'unverified@example.test', password: 'una-password-lunga' })
      .expect(403);
  });
});

describe('step-up (SPEC §3.1, §13.3)', () => {
  it('new device: sensitive endpoint answers STEP_UP_REQUIRED until the emailed code is confirmed', async () => {
    const { agent, email } = await verifiedUser('stepup');
    const denied = await agent.delete('/api/v1/me').set('origin', WEB).expect(401);
    expect(denied.body).toMatchObject({ code: 'STEP_UP_REQUIRED', requires: ['email_code'] });

    await agent.post('/api/v1/auth/step-up/email-code').set('origin', WEB).expect(204);
    const code = /(\d{6}) è il tuo codice/.exec(env.emails.last(email)?.subject ?? '')?.[1];
    await agent
      .post('/api/v1/auth/step-up')
      .set('origin', WEB)
      .send({ emailCode: '000000' === code ? '111111' : '000000' })
      .expect(401);
    const ok = await agent
      .post('/api/v1/auth/step-up')
      .set('origin', WEB)
      .send({ emailCode: code })
      .expect(200);
    expect(ok.body).toMatchObject({ satisfied: true });

    await agent.delete('/api/v1/me').set('origin', WEB).expect(204);
    const user = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'deleted-' } } });
    expect(user).toMatchObject({ status: 'DELETED', username: null, name: 'Utente eliminato' });
  });

  it('old authentication on a known device needs the password, also for Better Auth sensitive paths', async () => {
    const { agent, email } = await verifiedUser('olduser');
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    await db.knownDevice.updateMany({
      where: { userId: user.id },
      data: { firstSeenAt: new Date(Date.now() - 2 * 86_400_000) },
    });

    expect((await agent.get('/api/v1/auth/step-up').expect(200)).body).toMatchObject({
      satisfied: false,
      requires: ['password'],
    });
    const change = await agent
      .post('/api/auth/change-password')
      .set('origin', WEB)
      .send({ currentPassword: 'una-password-lunga', newPassword: 'nuova-password-lunga' });
    expect(change.status).toBe(401);
    expect(change.body.code).toBe('STEP_UP_REQUIRED');

    await agent
      .post('/api/v1/auth/step-up')
      .set('origin', WEB)
      .send({ password: 'sbagliata' })
      .expect(401);
    await agent
      .post('/api/v1/auth/step-up')
      .set('origin', WEB)
      .send({ password: 'una-password-lunga' })
      .expect(200);
    await agent.delete('/api/v1/me').set('origin', WEB).expect(204);
  });
});

describe('addresses: anti-IDOR', () => {
  it("a user cannot read, change or delete someone else's address", async () => {
    const a = await verifiedUser('alice');
    const b = await verifiedUser('bob');
    await db.regione.upsert({
      where: { id: '03' },
      create: { id: '03', name: 'Lombardia', slug: 'lombardia' },
      update: {},
    });
    await db.provincia.upsert({
      where: { id: '215' },
      create: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
      update: {},
    });
    await db.comune.upsert({
      where: { id: '015146' },
      create: { id: '015146', name: 'Milano', slug: 'milano', provinciaId: '215' },
      update: {},
    });

    const created = await a.agent
      .post('/api/v1/me/addresses')
      .set('origin', WEB)
      .send({
        type: 'SHIPPING',
        fullName: 'Alice',
        line1: 'Via Roma 1',
        cap: '20121',
        comuneId: '015146',
        phone: '3391234567',
      })
      .expect(201);
    const id = created.body.id as string;

    expect((await b.agent.get('/api/v1/me/addresses').expect(200)).body).toEqual([]);
    await b.agent
      .patch(`/api/v1/me/addresses/${id}`)
      .set('origin', WEB)
      .send({ fullName: 'Mallory' })
      .expect(404);
    await b.agent.delete(`/api/v1/me/addresses/${id}`).set('origin', WEB).expect(404);
    expect((await a.agent.get('/api/v1/me/addresses').expect(200)).body[0]).toMatchObject({
      id,
      fullName: 'Alice',
    });
  });

  it('rejects state-changing requests from foreign origins', async () => {
    const { agent } = await verifiedUser('origin');
    const res = await agent
      .post('/api/v1/me/addresses')
      .set('origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});
