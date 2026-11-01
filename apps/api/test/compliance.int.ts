import type { PrismaClient } from '@accordo/db';
import type { TaxStatus } from '@accordo/shared';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
type Agent = Awaited<ReturnType<ReturnType<typeof verifiedUserFactory>>>['agent'];

beforeAll(async () => {
  env = await startTestApp();
  db = env.app.get(PRISMA);
  verifiedUser = verifiedUserFactory(env);
  await db.platformSetting.createMany({
    data: [
      {
        key: 'dac7',
        value: {
          minActivities: 30,
          maxConsiderationCents: 200_000,
          requestAtBps: 8000,
          reminderEveryDays: 7,
          maxReminders: 3,
          blockPayoutsWithoutProfile: false,
        },
      },
      { key: 'bannedTerms', value: ['avorio'] },
    ],
  });
});
afterAll(() => env?.stop());

let n = 0;
async function user(name: string) {
  const u = await verifiedUser(`${name}${++n}`);
  const row = await db.user.findUniqueOrThrow({ where: { email: u.email } });
  return { ...u, id: row.id };
}

/** New device → emailed code (SPEC §13.3). */
async function stepUp(agent: Agent, email: string) {
  await agent.post('/api/v1/auth/step-up/email-code').set('origin', WEB).expect(204);
  const code = /(\d{6}) è il tuo codice/.exec(env.emails.last(email)?.subject ?? '')?.[1];
  await agent.post('/api/v1/auth/step-up').set('origin', WEB).send({ emailCode: code }).expect(200);
}

const TAX = {
  legalName: 'Mario Rossi',
  taxId: 'RSSMRA80A01H501U',
  birthDate: '1980-01-01',
  addressLine: 'Via Roma 1',
  cap: '00100',
  city: 'Roma',
  iban: 'IT60 X054 2811 1010 0000 0123 456',
};

describe('DAC7 tax profile (SPEC §14.4)', () => {
  it('stores tax code, birth date and IBAN encrypted, shows them masked', async () => {
    const u = await user('venditore');
    await u.agent.put('/api/v1/me/tax-profile').set('origin', WEB).send(TAX).expect(401);
    await stepUp(u.agent, u.email);
    await u.agent
      .put('/api/v1/me/tax-profile')
      .set('origin', WEB)
      .send({ ...TAX, taxId: 'RSSMRA80A01H501X' })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('TAX_ID_INVALID'));
    const saved = (
      await u.agent.put('/api/v1/me/tax-profile').set('origin', WEB).send(TAX).expect(200)
    ).body as TaxStatus;
    expect(saved.profile).toMatchObject({
      taxIdMasked: '••••••••••••501U',
      ibanMasked: expect.stringMatching(/3456$/),
    });

    // Read straight from the database: no plaintext anywhere.
    const [row] = await db.$queryRaw<
      Array<{ taxIdEnc: string; birthDateEnc: string; ibanEnc: string; taxIdHash: string }>
    >`SELECT "taxIdEnc", "birthDateEnc", "ibanEnc", "taxIdHash" FROM "TaxProfile" WHERE "userId" = ${u.id}`;
    const raw = JSON.stringify(row);
    for (const secret of [
      'RSSMRA80A01H501U',
      '1980-01-01',
      'IT60X0542811101000000123456',
      '0123456',
    ])
      expect(raw).not.toContain(secret);
    expect(row?.taxIdEnc).toMatch(/^k1:/);
    expect(row?.taxIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.outboxEvent.count({ where: { type: 'dac7.profile_saved' } })).toBe(1);
  });
});

describe('GDPR (SPEC §14.5)', () => {
  it('the export contains the user data; deletion anonymises', async () => {
    const u = await user('esporta');
    await db.address.create({
      data: {
        userId: u.id,
        type: 'SHIPPING',
        fullName: 'Esporta Prova',
        line1: 'Via Verdi 3',
        cap: '20121',
        comuneId: await db.regione
          .create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } })
          .then(() =>
            db.provincia.create({
              data: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
            }),
          )
          .then(() =>
            db.comune.create({
              data: { id: '015146', name: 'Milano', slug: 'milano', provinciaId: '215' },
            }),
          )
          .then((c) => c.id),
        phone: '3331234567',
      },
    });
    await u.agent.get('/api/v1/me/data-export').expect(401);
    await stepUp(u.agent, u.email);
    await u.agent.put('/api/v1/me/tax-profile').set('origin', WEB).send(TAX).expect(200);
    const res = await u.agent.get('/api/v1/me/data-export').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="accordo-dati-/);
    const data = res.body;
    expect(data.user).toMatchObject({ id: u.id, email: u.email });
    expect(data.addresses[0]).toMatchObject({ line1: 'Via Verdi 3', phone: '3331234567' });
    expect(data.taxProfile).toMatchObject({
      taxId: 'RSSMRA80A01H501U',
      iban: 'IT60X0542811101000000123456',
    });
    expect(data.sessions.length).toBeGreaterThan(0);
    // Secrets that are not personal data stay out.
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/"token"|deviceIdHash|password/);
    expect(await db.auditLog.count({ where: { actorId: u.id, action: 'gdpr.export' } })).toBe(1);

    await u.agent.delete('/api/v1/me').set('origin', WEB).expect(204);
    const gone = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(gone).toMatchObject({
      name: 'Utente eliminato',
      email: `deleted-${u.id}@deleted.invalid`,
      username: null,
      status: 'DELETED',
    });
    expect(await db.address.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('audit log, settings and webhooks', () => {
  it('the audit log is append-only in the database', async () => {
    const row = await db.auditLog.create({ data: { action: 'test', entityType: 'Test' } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/2 years/);
  });

  it('settings keep their shape; webhooks can be replayed once failed', async () => {
    const admin = await user('admin');
    await db.user.update({
      where: { id: admin.id },
      data: { role: 'admin', twoFactorEnabled: true },
    });
    await stepUp(admin.agent, admin.email);
    await admin.agent
      .put('/api/v1/admin/settings/bannedTerms')
      .set('origin', WEB)
      .send({ value: { avorio: true } })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('SETTING_SHAPE'));
    await admin.agent
      .put('/api/v1/admin/settings/bannedTerms')
      .set('origin', WEB)
      .send({ value: ['avorio', 'tartaruga'] })
      .expect(200);
    expect(
      (await db.platformSetting.findUniqueOrThrow({ where: { key: 'bannedTerms' } })).value,
    ).toEqual(['avorio', 'tartaruga']);
    expect(await db.auditLog.count({ where: { action: 'settings.update' } })).toBe(1);

    await db.webhookEvent.create({
      data: {
        provider: 'fake',
        eventId: 'evt_1',
        type: 'payment.succeeded',
        payload: {},
        attempts: 5,
        lastError: 'boom',
      },
    });
    const failed = (await admin.agent.get('/api/v1/admin/webhooks?status=failed').expect(200)).body;
    expect(failed).toEqual([expect.objectContaining({ eventId: 'evt_1', lastError: 'boom' })]);
    await admin.agent
      .post('/api/v1/admin/webhooks/fake/evt_1/replay')
      .set('origin', WEB)
      .expect(202);
    expect(
      await db.outboxEvent.count({ where: { type: 'webhook.received', aggregateId: 'evt_1' } }),
    ).toBe(1);
    await db.webhookEvent.update({
      where: { provider_eventId: { provider: 'fake', eventId: 'evt_1' } },
      data: { processedAt: new Date() },
    });
    await admin.agent
      .post('/api/v1/admin/webhooks/fake/evt_1/replay')
      .set('origin', WEB)
      .expect(409);
  });
});
