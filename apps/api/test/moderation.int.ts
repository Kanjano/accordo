import type { PrismaClient } from '@accordo/db';
import type { AdminReportItem, ModerationActionItem } from '@accordo/shared';
import request from 'supertest';
import { ModerationService } from '../src/modules/moderation/moderation.service.js';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;

beforeAll(async () => {
  env = await startTestApp();
  db = env.app.get(PRISMA);
  verifiedUser = verifiedUserFactory(env);
  await db.regione.create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } });
  await db.provincia.create({
    data: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
  });
  await db.comune.create({
    data: { id: '015146', name: 'Milano', slug: 'milano', provinciaId: '215' },
  });
  const dept = await db.department.create({ data: { slug: 'archi', name: 'Archi' } });
  categoryId = (
    await db.category.create({ data: { departmentId: dept.id, slug: 'violini', name: 'Violini' } })
  ).id;
  await db.platformSetting.create({
    data: { key: 'listings', value: { durationDays: 60, maxImages: 20, bumpEveryDays: 7 } },
  });
});
afterAll(() => env?.stop());

let n = 0;
async function user(name: string) {
  const u = await verifiedUser(`${name}${++n}`);
  const row = await db.user.findUniqueOrThrow({ where: { email: u.email } });
  return { ...u, id: row.id };
}
async function staff(role = 'moderator') {
  const s = await user(role);
  await db.user.update({ where: { id: s.id }, data: { role, twoFactorEnabled: true } });
  return s;
}
const listing = (sellerId: string) =>
  db.listing.create({
    data: {
      shortId: `M${String(++n).padStart(7, '0')}`,
      slug: 'violino',
      sellerId,
      categoryId,
      status: 'ACTIVE',
      title: 'Violino 4/4 copia Stradivari',
      description: 'Violino da studio.',
      condition: 'GOOD',
      priceCents: 30_000,
      comuneId: '015146',
      publishedAt: new Date(),
    },
  });
const REPORT = {
  targetType: 'LISTING',
  reasonCode: 'COUNTERFEIT',
  details: 'Il marchio sembra contraffatto: etichetta e foto prese da un altro sito.',
  goodFaithConfirmed: true,
};

describe('back office access (SPEC §3.10)', () => {
  it('admin routes need a staff role with 2FA', async () => {
    const plain = await user('utente');
    await plain.agent.get('/api/v1/admin/dashboard').expect(403);
    const mod = await user('mod');
    await db.user.update({ where: { id: mod.id }, data: { role: 'moderator' } });
    const denied = await mod.agent.get('/api/v1/admin/dashboard').expect(403);
    expect(denied.body.code).toBe('TWO_FACTOR_REQUIRED');
    await db.user.update({ where: { id: mod.id }, data: { twoFactorEnabled: true } });
    await mod.agent.get('/api/v1/admin/dashboard').expect(200);
    // Settings and the audit log are admin-only.
    await mod.agent.get('/api/v1/admin/settings').expect(403);
    await mod.agent.get('/api/v1/admin/audit').expect(403);
    // Bull Board: same rules.
    await plain.agent.get('/admin/queues').expect(403);
  });
});

describe('notice and action (SPEC §14.2) and J7 at API level', () => {
  it('report → removal with statement of reasons → appeal reviewed by someone else', async () => {
    const seller = await user('venditore');
    const l = await listing(seller.id);
    const http = request(env.app.getHttpServer());

    // Anonymous reporters must identify themselves.
    await http
      .post('/api/v1/reports')
      .set('origin', WEB)
      .send({ ...REPORT, targetId: l.id })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('REPORTER_REQUIRED'));
    const anon = (
      await http
        .post('/api/v1/reports')
        .set('origin', WEB)
        .send({
          ...REPORT,
          targetId: l.id,
          reporterName: 'Mario Rossi',
          reporterEmail: 'mario@example.test',
          isIllegalContent: true,
        })
        .expect(201)
    ).body as { id: string };
    const reporter = await user('segnalatore');
    await reporter.agent
      .post('/api/v1/reports')
      .set('origin', WEB)
      .send({ ...REPORT, targetId: l.id })
      .expect(201);
    expect(await db.outboxEvent.count({ where: { type: 'report.created' } })).toBe(2);

    const mod = await staff();
    const queue = (await mod.agent.get('/api/v1/admin/reports').expect(200))
      .body as AdminReportItem[];
    const item = queue.find((r) => r.id === anon.id);
    expect(item).toMatchObject({
      isIllegalContent: true,
      targetUserId: seller.id,
      sameTarget: 1,
      reporter: { email: 'mario@example.test' },
    });

    await mod.agent
      .post(`/api/v1/admin/reports/${anon.id}/decide`)
      .set('origin', WEB)
      .send({ decision: 'HIDE_MESSAGE', reasonCode: 'COUNTERFEIT', statement: 'x'.repeat(30) })
      .expect(400);
    await mod.agent
      .post(`/api/v1/admin/reports/${anon.id}/decide`)
      .set('origin', WEB)
      .send({
        decision: 'REMOVE_LISTING',
        reasonCode: 'COUNTERFEIT',
        statement:
          'Annuncio rimosso: prodotto contraffatto, vietato dalle Regole di pubblicazione.',
        legalGround: 'D.Lgs. 30/2005 (Codice della proprietà industriale)',
      })
      .expect(204);
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('REMOVED');
    // Both notices on the same listing are closed, each reporter is told.
    expect(await db.report.count({ where: { targetId: l.id, status: 'ACTION_TAKEN' } })).toBe(2);
    expect(await db.outboxEvent.count({ where: { type: 'report.decided' } })).toBe(2);
    expect(await db.outboxEvent.count({ where: { type: 'moderation.action' } })).toBe(1);

    const [action] = (await seller.agent.get('/api/v1/me/moderation-actions').expect(200))
      .body as ModerationActionItem[];
    expect(action).toMatchObject({
      actionType: 'LISTING_REMOVED',
      canAppeal: true,
      legalGround: 'D.Lgs. 30/2005 (Codice della proprietà industriale)',
    });
    const appeal = { text: 'Il violino è originale, allego la fattura di acquisto del negozio.' };
    await seller.agent
      .post(`/api/v1/moderation-actions/${action?.id}/appeal`)
      .set('origin', WEB)
      .send(appeal)
      .expect(201);
    await seller.agent
      .post(`/api/v1/moderation-actions/${action?.id}/appeal`)
      .set('origin', WEB)
      .send(appeal)
      .expect(409);
    // Another user can't appeal someone else's decision.
    await reporter.agent
      .post(`/api/v1/moderation-actions/${action?.id}/appeal`)
      .set('origin', WEB)
      .send(appeal)
      .expect(404);

    const decision = { outcome: 'REVERSED', statement: 'La fattura dimostra che è originale.' };
    await mod.agent
      .post(`/api/v1/admin/moderation-actions/${action?.id}/appeal-decision`)
      .set('origin', WEB)
      .send(decision)
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('SAME_REVIEWER'));
    const other = await staff();
    expect((await other.agent.get('/api/v1/admin/appeals').expect(200)).body).toHaveLength(1);
    await other.agent
      .post(`/api/v1/admin/moderation-actions/${action?.id}/appeal-decision`)
      .set('origin', WEB)
      .send(decision)
      .expect(204);
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('ACTIVE');
    expect(await db.outboxEvent.count({ where: { type: 'moderation.appeal_decided' } })).toBe(1);
  });

  it('messages can be reported only by the other participant', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const stranger = await user('estraneo');
    const l = await listing(seller.id);
    const c = await db.conversation.create({
      data: { listingId: l.id, buyerId: buyer.id, sellerId: seller.id, lastMessageAt: new Date() },
    });
    const m = await db.message.create({
      data: { conversationId: c.id, senderId: seller.id, body: 'Pagami con una ricarica.' },
    });
    const body = { ...REPORT, targetType: 'MESSAGE', targetId: m.id, reasonCode: 'SCAM' };
    await stranger.agent.post('/api/v1/reports').set('origin', WEB).send(body).expect(404);
    await seller.agent.post('/api/v1/reports').set('origin', WEB).send(body).expect(404);
    await buyer.agent.post('/api/v1/reports').set('origin', WEB).send(body).expect(201);
  });
});

describe('sanctions (SPEC §3.10)', () => {
  it('suspension signs the user out, pauses listings and is reversible; staff are protected', async () => {
    const seller = await user('venditore');
    const l = await listing(seller.id);
    const mod = await staff();
    const service = env.app.get(ModerationService);
    await service.sanction(mod.id, seller.id, {
      type: 'SUSPEND',
      reasonCode: 'FRAUD',
      statement: 'Tentativi ripetuti di pagamento fuori piattaforma.',
      days: 7,
    });
    const u = await db.user.findUniqueOrThrow({ where: { id: seller.id } });
    expect(u).toMatchObject({ status: 'SUSPENDED', banned: true });
    expect(u.banExpires?.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(await db.session.count({ where: { userId: seller.id } })).toBe(0);
    await seller.agent.get('/api/v1/me').expect(401);
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('PAUSED');

    await service.reinstate(mod.id, seller.id, 'Chiarimento ricevuto, account riattivato.');
    expect(await db.user.findUniqueOrThrow({ where: { id: seller.id } })).toMatchObject({
      status: 'ACTIVE',
      banned: false,
    });
    await expect(
      service.sanction(seller.id, mod.id, {
        type: 'BAN',
        reasonCode: 'ABUSE',
        statement: 'Prova di sanzione verso un membro dello staff.',
        days: 7,
      }),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_SANCTION_STAFF' } });
    expect(await db.auditLog.count({ where: { entityId: seller.id } })).toBeGreaterThanOrEqual(2);
  });
});
