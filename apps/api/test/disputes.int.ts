import type { PrismaClient } from '@accordo/db';
import type { OrderEvent } from '@accordo/domain';
import { applyOrderEvent } from '@accordo/orders';
import type { CheckoutResponse, DisputeDetail, OrderDetail } from '@accordo/shared';
import { DisputesService } from '../src/modules/orders/disputes.service.js';
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

/** A self-shipped order, paid, shipped and (optionally) delivered. */
async function deliveredOrder(delivered = true) {
  const s = await seller();
  const b = await user('acquirente');
  const address = await db.address.create({
    data: {
      userId: b.id,
      fullName: 'Bea Rossi',
      line1: 'Via Roma 1',
      cap: '20121',
      comuneId: '015146',
      phone: '3331234567',
    },
  });
  const l = await listing(s.id);
  const { orderId, amounts } = (
    await checkout(b.agent, {
      listingId: l.id,
      deliveryMethod: 'SHIPPING_SELF',
      addressId: address.id,
    }).expect(201)
  ).body as CheckoutResponse;
  await pay(orderId, amounts.totalCents);
  await post(s.agent, `/orders/${orderId}/ship`, {
    carrier: 'BRT',
    trackingNumber: 'BRT123456789',
  }).expect(201);
  if (delivered)
    await db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        orderId,
        { type: 'DELIVERED', deliveredAt: new Date() },
        { role: 'SYSTEM', id: null },
        { handoverPepper: 'test-handover-pepper' },
      ),
    );
  return { s, b, orderId, amounts };
}

const DESCRIPTION = "L'amplificatore ha un graffio profondo sul lato non indicato nell'annuncio.";
const open = (agent: Agent, orderId: string, body: object = {}) =>
  agent
    .post(`/api/v1/orders/${orderId}/dispute`)
    .set('origin', WEB)
    .set('idempotency-key', `dispute-${orderId}-${Math.random().toString(36).slice(2)}`)
    .send({ reason: 'OTHER', description: DESCRIPTION, ...body });
const effects = async (orderId: string) =>
  JSON.stringify(
    (await db.outboxEvent.findMany({ where: { aggregateId: orderId, type: 'order.effects' } })).map(
      (e) => e.payload,
    ),
  );
async function staff(name: string) {
  return (
    await db.user.create({
      data: { name, email: `${name}${++n}@example.test`, emailVerified: true, role: 'support' },
    })
  ).id;
}

describe('opening a dispute (SPEC §6.6)', () => {
  it('validates description, photos, timing and the party', async () => {
    const shipped = await deliveredOrder(false);
    // Not received: only after the expected delivery + 3 days (or 14 days without estimate).
    expect(
      (await open(shipped.b.agent, shipped.orderId, { reason: 'NOT_RECEIVED' })).body.code,
    ).toBe('DISPUTE_NOT_ALLOWED');

    const { b, s, orderId } = await deliveredOrder();
    expect((await open(b.agent, orderId, { description: 'troppo corta' })).status).toBe(400);
    expect((await open(b.agent, orderId, { reason: 'DAMAGED' })).body.code).toBe('PHOTOS_REQUIRED');
    expect((await open(s.agent, orderId)).status).toBe(404); // the seller can't open one
    const d = (await open(b.agent, orderId).expect(201)).body as DisputeDetail;
    expect(d).toMatchObject({
      status: 'OPEN',
      role: 'BUYER',
      actions: expect.arrayContaining(['withdraw', 'escalate']),
    });
    expect((await open(b.agent, orderId)).body.code).toBe('DISPUTE_EXISTS');
    const order = (await b.agent.get(`/api/v1/orders/${orderId}`).expect(200)).body as OrderDetail;
    expect(order).toMatchObject({ status: 'DISPUTED', dispute: { id: d.id, status: 'OPEN' } });
    expect(order.deadlines.nextActionAt).toBe(d.sellerResponseDueAt);
    const stranger = await user('curioso');
    await stranger.agent.get(`/api/v1/disputes/${d.id}`).expect(404);
    expect((await s.agent.get(`/api/v1/disputes/${d.id}`).expect(200)).body.actions).toContain(
      'respond',
    );
  });
});

describe('dispute procedure', () => {
  it('partial proposal accepted by the buyer: partial refund, the rest transferred (J5 money path)', async () => {
    const { b, s, orderId, amounts } = await deliveredOrder();
    const d = (await open(b.agent, orderId).expect(201)).body as DisputeDetail;
    await post(b.agent, `/disputes/${d.id}/respond`, { action: 'REJECT', message: 'no' }).expect(
      403,
    );
    const proposed = (
      await post(s.agent, `/disputes/${d.id}/respond`, {
        action: 'PROPOSE_PARTIAL',
        amountCents: 3000,
        message: 'Ti rimborso 30 € per il graffio.',
      }).expect(201)
    ).body as DisputeDetail;
    expect(proposed).toMatchObject({ status: 'AWAITING_BUYER', proposedRefundCents: 3000 });
    expect(
      (
        await post(s.agent, `/disputes/${d.id}/respond`, {
          action: 'PROPOSE_PARTIAL',
          amountCents: 999_999,
          message: 'x',
        })
      ).body.code,
    ).toBe('INVALID_DISPUTE_STATE');
    const done = (await post(b.agent, `/disputes/${d.id}/accept-proposal`).expect(201))
      .body as DisputeDetail;
    expect(done).toMatchObject({
      status: 'RESOLVED',
      outcome: 'REFUND_PARTIAL',
      resolvedRefundCents: 3000,
      orderStatus: 'COMPLETED',
    });
    const fx = await effects(orderId);
    expect(fx).toContain('"type":"REFUND","amountCents":3000,"includesBuyerFee":false');
    expect(fx).toContain(
      `"type":"TRANSFER_TO_SELLER","amountCents":${amounts.sellerNetCents - 3000}`,
    );
    expect(done.messages.map((m) => m.authorRole)).toEqual(['SELLER']);
  });

  it('missed seller deadline escalates; staff decides with motivation; appeal goes to another reviewer', async () => {
    const { b, s, orderId } = await deliveredOrder();
    const d = (await open(b.agent, orderId).expect(201)).body as DisputeDetail;
    // Development endpoint: run the dispute timer now (the sweeper does it in production).
    expect((await post(s.agent, `/dev/orders/${orderId}/run-timer`).expect(200)).body).toEqual({
      action: 'DISPUTE_SELLER_DEADLINE',
      ran: 'dispute',
    });
    expect((await b.agent.get(`/api/v1/disputes/${d.id}`)).body.status).toBe('UNDER_REVIEW');
    await post(b.agent, `/admin/disputes/${d.id}/resolve`, {
      outcome: 'REFUND_FULL',
      sellerAtFault: true,
      notes: 'x'.repeat(20),
    }).expect(403);

    const disputes = env.app.get(DisputesService);
    const first = await staff('primo');
    const decided = await disputes.act(
      first,
      d.id,
      { type: 'RESOLVE', outcome: 'REFUND_FULL', sellerAtFault: true },
      { staff: true, notes: "Danno evidente nelle foto, non dichiarato nell'annuncio." },
    );
    expect(decided).toMatchObject({
      status: 'RESOLVED',
      outcome: 'REFUND_FULL',
      sellerAtFault: true,
      orderStatus: 'REFUNDED',
    });
    expect(
      (await db.userReputation.findUniqueOrThrow({ where: { userId: s.id } })).disputesLost12m,
    ).toBe(1);
    expect((await s.agent.get(`/api/v1/disputes/${d.id}`)).body.actions).toContain('appeal');

    const appealed = (await post(s.agent, `/disputes/${d.id}/appeal`).expect(201))
      .body as DisputeDetail;
    expect(appealed.appealedAt).not.toBeNull();
    expect((await post(b.agent, `/disputes/${d.id}/appeal`)).body.code).toBe('ALREADY_APPEALED');
    await expect(
      disputes.act(
        first,
        d.id,
        { type: 'APPEAL_DECISION', upheld: true },
        { staff: true, notes: 'x'.repeat(20) },
      ),
    ).rejects.toMatchObject({ response: { code: 'SAME_REVIEWER' } });
    const second = await staff('secondo');
    expect(
      await disputes.act(
        second,
        d.id,
        { type: 'APPEAL_DECISION', upheld: true },
        { staff: true, notes: 'Decisione confermata dopo riesame delle foto.' },
      ),
    ).toMatchObject({ appealUpheld: true });
  });

  it('accepting the return: return label, then a missed return pays the seller', async () => {
    const { b, s, orderId } = await deliveredOrder();
    const d = (await open(b.agent, orderId).expect(201)).body as DisputeDetail;
    const ret = (
      await post(s.agent, `/disputes/${d.id}/respond`, {
        action: 'ACCEPT_REFUND_WITH_RETURN',
        message: 'Rimandalo pure.',
      }).expect(201)
    ).body as DisputeDetail;
    expect(ret).toMatchObject({
      status: 'AWAITING_RETURN',
      orderStatus: 'RETURN_IN_TRANSIT',
      sellerAtFault: true,
    });
    expect(await effects(orderId)).toContain('CREATE_RETURN_LABEL');
    expect((await post(s.agent, `/disputes/${d.id}/escalate`)).body.code).toBe(
      'INVALID_DISPUTE_STATE',
    ); // return not delivered yet
    expect((await post(b.agent, `/dev/orders/${orderId}/run-timer`).expect(200)).body.ran).toBe(
      'event',
    );
    expect((await b.agent.get(`/api/v1/disputes/${d.id}`)).body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'RELEASE_TO_SELLER',
      orderStatus: 'COMPLETED',
    });
  });

  it('withdrawal releases the payment', async () => {
    const { b, orderId, amounts } = await deliveredOrder();
    const d = (await open(b.agent, orderId).expect(201)).body as DisputeDetail;
    expect((await post(b.agent, `/disputes/${d.id}/withdraw`).expect(201)).body).toMatchObject({
      status: 'WITHDRAWN',
      orderStatus: 'COMPLETED',
    });
    expect(await effects(orderId)).toContain(
      `"type":"TRANSFER_TO_SELLER","amountCents":${amounts.sellerNetCents}`,
    );
  });
});

describe('J8: cancellation for missed shipment', () => {
  it('the ship timer (reminder, then deadline) cancels the order with a full refund', async () => {
    const s = await seller();
    const b = await user('acquirente');
    const address = await db.address.create({
      data: {
        userId: b.id,
        fullName: 'Bea Rossi',
        line1: 'Via Roma 1',
        cap: '20121',
        comuneId: '015146',
        phone: '3331234567',
      },
    });
    const l = await listing(s.id);
    const { orderId, amounts } = (
      await checkout(b.agent, {
        listingId: l.id,
        deliveryMethod: 'SHIPPING_SELF',
        addressId: address.id,
      })
    ).body as CheckoutResponse;
    await pay(orderId, amounts.totalCents);
    expect((await post(b.agent, `/dev/orders/${orderId}/run-timer`).expect(200)).body).toEqual({
      action: 'SHIP_REMINDER',
      ran: 'reminder',
    });
    expect((await post(b.agent, `/dev/orders/${orderId}/run-timer`).expect(200)).body).toEqual({
      action: 'SHIP_DEADLINE',
      ran: 'event',
    });
    const o = (await b.agent.get(`/api/v1/orders/${orderId}`)).body as OrderDetail;
    expect(o.status).toBe('CANCELLED');
    expect(await effects(orderId)).toContain(
      `"type":"REFUND","amountCents":${amounts.totalCents},"includesBuyerFee":true`,
    );
    expect(
      (await db.userReputation.findUniqueOrThrow({ where: { userId: s.id } }))
        .sellerCancellations12m,
    ).toBe(1);
  });
});
