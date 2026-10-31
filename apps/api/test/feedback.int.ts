import type { PrismaClient } from '@accordo/db';
import type { OrderEvent } from '@accordo/domain';
import { applyOrderEvent, recomputeReputation } from '@accordo/orders';
import type { CheckoutResponse, FeedbackItem, ReputationDto } from '@accordo/shared';
import request from 'supertest';
import { FeedbackService } from '../src/modules/feedback/feedback.service.js';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;
type Agent = Awaited<ReturnType<ReturnType<typeof verifiedUserFactory>>>['agent'];

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
  const dept = await db.department.create({ data: { slug: 'fiati', name: 'Fiati' } });
  categoryId = (
    await db.category.create({ data: { departmentId: dept.id, slug: 'sassofoni', name: 'Sax' } })
  ).id;
  await db.platformSetting.createMany({
    data: [
      {
        key: 'fees',
        value: {
          buyerFeeBps: 400,
          buyerFeeFixedCents: 50,
          buyerFeeMinCents: 100,
          buyerFeeMaxCents: 2500,
          sellerCommissionBps: 0,
          vatRateBps: 2200,
        },
      },
      { key: 'orderTimings', value: {} },
      { key: 'feedback', value: { windowDays: 60, minOrderCents: 300 } },
      { key: 'feedbackInsults', value: ['idiota'] },
      {
        key: 'parcelSizes',
        value: {
          S: { priceCents: 590, maxKg: 2, dimensionsCm: [40, 30, 10] },
          M: { priceCents: 790, maxKg: 5, dimensionsCm: [60, 40, 20] },
          L: { priceCents: 1290, maxKg: 15, dimensionsCm: [120, 50, 20] },
          XL: { priceCents: 2490, maxKg: 30, dimensionsCm: [150, 60, 40] },
        },
      },
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

async function seller() {
  const s = await user('venditore');
  await db.paymentAccount.create({
    data: {
      userId: s.id,
      provider: 'fake',
      providerAccountId: `fake_acct_${s.id}`,
      transfersEnabled: true,
    },
  });
  return s;
}

const listing = (sellerId: string, over: Record<string, unknown> = {}) =>
  db.listing.create({
    data: {
      shortId: `O${String(++n).padStart(7, '0')}`,
      slug: 'sax',
      sellerId,
      categoryId,
      status: 'ACTIVE',
      title: 'Selmer Mark VI',
      description: 'Sax contralto.',
      condition: 'GOOD',
      priceCents: 12_000,
      comuneId: '015146',
      protectedPaymentEnabled: true,
      handDeliveryEnabled: true,
      shippingSelf: true,
      selfShippingPriceCents: 1000,
      shippingIntegrated: false,
      ...over,
    },
  });

const checkout = (agent: Agent, body: object, key = `k-${Math.random().toString(36).slice(2)}`) =>
  agent.post('/api/v1/orders').set('origin', WEB).set('idempotency-key', key).send(body);

/** What the worker does on `payment_intent.succeeded` (covered by the worker tests). */
const pay = (orderId: string, totalCents: number) =>
  db.$transaction((tx) =>
    applyOrderEvent(
      tx,
      orderId,
      { type: 'PAYMENT_SUCCEEDED', amountCents: totalCents, currency: 'eur' } as OrderEvent,
      { role: 'SYSTEM', id: null },
      { handoverPepper: 'test-handover-pepper' },
    ),
  );

const post = (agent: Agent, path: string, body: object = {}) =>
  agent.post(`/api/v1${path}`).set('origin', WEB).send(body);

/** A completed hand-delivery order between a fresh seller and buyer. */
async function completed() {
  const s = await seller();
  const b = await user('acquirente');
  await db.user.update({ where: { id: s.id }, data: { username: `venditore${n}` } });
  const l = await listing(s.id);
  const { orderId, amounts } = (
    await checkout(b.agent, { listingId: l.id, deliveryMethod: 'HAND_DELIVERY' }).expect(201)
  ).body as CheckoutResponse;
  await pay(orderId, amounts.totalCents);
  await db.$transaction((tx) =>
    applyOrderEvent(
      tx,
      orderId,
      { type: 'HANDOVER_CODE_VERIFIED' },
      { role: 'SELLER', id: s.id },
      { handoverPepper: 'test-handover-pepper' },
    ),
  );
  const username = (await db.user.findUniqueOrThrow({ where: { id: s.id } })).username as string;
  return { s, b, orderId, username };
}

const NEGATIVE = {
  rating: 'NEGATIVE',
  comment: 'Lo strumento aveva un difetto non dichiarato.',
  dsr: { itemAsDescribed: 2, communication: 3 },
};

describe('leaving feedback (SPEC §8.1–8.2)', () => {
  it('only on completed orders, one per role, content rules, seller only positive', async () => {
    const { s, b, orderId } = await completed();
    await post(b.agent, `/orders/${orderId}/feedback`, { rating: 'NEGATIVE' }).expect(422);
    expect(
      (
        await post(b.agent, `/orders/${orderId}/feedback`, {
          ...NEGATIVE,
          dsr: { ...NEGATIVE.dsr, packaging: 4 },
        })
      ).body.code,
    ).toBe('DSR_NOT_ALLOWED'); // hand delivery
    const left = (await post(b.agent, `/orders/${orderId}/feedback`, NEGATIVE).expect(201))
      .body as FeedbackItem;
    expect(left).toMatchObject({
      rating: 'NEGATIVE',
      status: 'PUBLISHED',
      role: 'BUYER_TO_SELLER',
    });
    expect((await post(b.agent, `/orders/${orderId}/feedback`, NEGATIVE)).body.code).toBe(
      'FEEDBACK_EXISTS',
    );
    expect(
      (
        await post(s.agent, `/orders/${orderId}/feedback`, {
          rating: 'NEGATIVE',
          comment: 'x'.repeat(30),
        })
      ).body.code,
    ).toBe('SELLER_ONLY_POSITIVE');
    await post(s.agent, `/orders/${orderId}/feedback`, { rating: 'POSITIVE' }).expect(201);
    expect(
      await db.outboxEvent.count({
        where: { type: 'feedback.created', payload: { path: ['orderId'], equals: orderId } },
      }),
    ).toBe(2);
  });

  it('closes after 60 days and refuses unfinished orders', async () => {
    const { b, orderId } = await completed();
    await db.order.update({
      where: { id: orderId },
      data: { completedAt: new Date(Date.now() - 61 * 86_400_000) },
    });
    expect(
      (await post(b.agent, `/orders/${orderId}/feedback`, { rating: 'POSITIVE' })).body.code,
    ).toBe('WINDOW_CLOSED');
    await db.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' } });
    expect(
      (await post(b.agent, `/orders/${orderId}/feedback`, { rating: 'POSITIVE' })).body.code,
    ).toBe('ORDER_NOT_COMPLETED');
  });

  it('hides feedback with contacts or insults until reviewed; staff removal is motivated', async () => {
    const { b, orderId, username } = await completed();
    const hidden = (
      await post(b.agent, `/orders/${orderId}/feedback`, {
        rating: 'POSITIVE',
        comment: 'Ottimo, chiamatelo al 333 123 4567',
        dsr: { itemAsDescribed: 5, communication: 5 },
      }).expect(201)
    ).body as FeedbackItem;
    expect(hidden.status).toBe('HIDDEN');
    expect(
      (await request(env.app.getHttpServer()).get(`/api/v1/users/${username}/feedback`).expect(200))
        .body.items,
    ).toEqual([]);
    const service = env.app.get(FeedbackService);
    expect((await service.moderationQueue()).map((f) => f.id)).toContain(hidden.id);
    const staffId = (
      await db.user.create({
        data: { name: 'Mod', email: `mod${++n}@example.test`, role: 'moderator' },
      })
    ).id;
    await service.remove(
      staffId,
      hidden.id,
      'PERSONAL_DATA',
      'Il commento conteneva un numero di telefono.',
    );
    expect(
      await db.moderationAction.count({
        where: { targetId: hidden.id, actionType: 'FEEDBACK_REMOVED' },
      }),
    ).toBe(1);
    expect(
      await db.outboxEvent.count({ where: { type: 'feedback.removed', aggregateId: hidden.id } }),
    ).toBe(1);
  });
});

describe('replies, revisions and reports (SPEC §8.3)', () => {
  it('one reply; one revision request that can only improve the rating', async () => {
    const { s, b, orderId } = await completed();
    const f = (await post(b.agent, `/orders/${orderId}/feedback`, NEGATIVE).expect(201))
      .body as FeedbackItem;
    await post(b.agent, `/feedback/${f.id}/reply`, { body: 'x' }).expect(404); // only the recipient
    await post(s.agent, `/feedback/${f.id}/reply`, {
      body: 'Mi dispiace, possiamo risolvere.',
    }).expect(201);
    expect((await post(s.agent, `/feedback/${f.id}/reply`, { body: 'Ancora' })).body.code).toBe(
      'ALREADY_REPLIED',
    );

    const [request1] = (
      await post(s.agent, `/feedback/${f.id}/revision-request`, {
        message: 'Ho sostituito il pezzo difettoso.',
      }).expect(201)
    ).body;
    expect(
      (await post(s.agent, `/feedback/${f.id}/revision-request`, { message: 'Di nuovo' })).body
        .code,
    ).toBe('ALREADY_REQUESTED');
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: orderId,
          payload: { path: ['effects', '0', 'template'], equals: 'feedback.revision_requested' },
        },
      }),
    ).toBe(1);
    await post(s.agent, `/revision-requests/${request1.id}/accept`, { rating: 'POSITIVE' }).expect(
      404,
    ); // only the author answers
    expect(
      (
        await post(b.agent, `/revision-requests/${request1.id}/accept`, {
          rating: 'NEGATIVE',
          comment: NEGATIVE.comment,
        })
      ).status,
    ).toBe(201);
    const revised = await db.feedback.findUniqueOrThrow({ where: { id: f.id } });
    expect(revised).toMatchObject({ rating: 'NEGATIVE', previousRating: 'NEGATIVE' });
  });

  it('a revision cannot worsen the rating; requests have a yearly quota', async () => {
    const { s, b, orderId } = await completed();
    const f = (
      await post(b.agent, `/orders/${orderId}/feedback`, {
        rating: 'NEUTRAL',
        comment: 'Tutto ok ma imballo scarso.',
        dsr: { itemAsDescribed: 4, communication: 4 },
      }).expect(201)
    ).body as FeedbackItem;
    const [r] = (
      await post(s.agent, `/feedback/${f.id}/revision-request`, {
        message: 'Potresti rivedere?',
      }).expect(201)
    ).body;
    expect(
      (
        await post(b.agent, `/revision-requests/${r.id}/accept`, {
          rating: 'NEGATIVE',
          comment: 'Ho cambiato idea, peggio di così.',
        })
      ).body.code,
    ).toBe('REVISION_WORSE');
    const ok = await post(b.agent, `/revision-requests/${r.id}/accept`, {
      rating: 'POSITIVE',
      comment: 'Risolto tutto, grazie!',
    }).expect(201);
    expect(ok.body[0].status).toBe('ACCEPTED');
    expect(await db.feedback.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      rating: 'POSITIVE',
      previousRating: 'NEUTRAL',
      previousComment: 'Tutto ok ma imballo scarso.',
    });

    // 5 requests already used this year → quota exceeded.
    const other = await completed();
    const g = (await post(other.b.agent, `/orders/${other.orderId}/feedback`, NEGATIVE).expect(201))
      .body as FeedbackItem;
    const fake = await db.feedback.findMany({
      where: { recipientId: { not: other.s.id } },
      take: 5,
      select: { id: true },
    });
    expect(fake).toHaveLength(5);
    for (const x of fake)
      await db.feedbackRevisionRequest.upsert({
        where: { feedbackId: x.id },
        create: { feedbackId: x.id, requesterId: other.s.id, message: 'x', expiresAt: new Date() },
        update: { requesterId: other.s.id },
      });
    expect(
      (await post(other.s.agent, `/feedback/${g.id}/revision-request`, { message: 'Per favore' }))
        .body.code,
    ).toBe('QUOTA_EXCEEDED');
  });

  it('anyone can report a feedback, e.g. extortion', async () => {
    const { b, orderId } = await completed();
    const f = (await post(b.agent, `/orders/${orderId}/feedback`, NEGATIVE).expect(201))
      .body as FeedbackItem;
    const third = await user('terzo');
    await post(third.agent, `/feedback/${f.id}/report`, {
      reasonCode: 'EXTORTION',
      details: 'Chiedeva uno sconto in cambio della modifica.',
    }).expect(204);
    expect(
      await db.report.count({
        where: { targetType: 'FEEDBACK', targetId: f.id, reasonCode: 'EXTORTION' },
      }),
    ).toBe(1);
  });
});

describe('reputation (SPEC §8.4–8.9)', () => {
  it('aggregates after recomputation: percentage, periods, masked authors', async () => {
    const { s, b, orderId, username } = await completed();
    await post(b.agent, `/orders/${orderId}/feedback`, {
      rating: 'POSITIVE',
      dsr: { itemAsDescribed: 5, communication: 5 },
    }).expect(201);
    await recomputeReputation(db, s.id);
    const rep = (
      await request(env.app.getHttpServer()).get(`/api/v1/users/${username}/reputation`).expect(200)
    ).body as ReputationDto;
    expect(rep).toMatchObject({
      score: 1,
      sellerPositivePctBps: 10_000,
      completedSales: 1,
      periods: { m1: { positive: 1, neutral: 0, negative: 0 } },
    });
    expect(rep.dsr.itemAsDescribed).toBeNull(); // fewer than 5 ratings
    const list = (
      await request(env.app.getHttpServer())
        .get(`/api/v1/users/${username}/feedback?role=seller`)
        .expect(200)
    ).body;
    expect(list.items[0].author.name).toMatch(/^.\*\*\*.$/);
    expect((await b.agent.get('/api/v1/me/feedback/pending').expect(200)).body).toEqual([]);
    expect((await s.agent.get('/api/v1/me/feedback/pending').expect(200)).body[0]).toMatchObject({
      orderId,
      role: 'SELLER_TO_BUYER',
    });
  });
});
