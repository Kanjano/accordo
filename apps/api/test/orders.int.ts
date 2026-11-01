import type { PrismaClient } from '@accordo/db';
import type { OrderEvent } from '@accordo/domain';
import { applyOrderEvent } from '@accordo/orders';
import { fakeWebhookBody, signFakeWebhook } from '@accordo/payments';
import type { CheckoutResponse, OrderDetail } from '@accordo/shared';
import { MOCK_SIGNATURE_HEADER, mockWebhookBody, signMockWebhook } from '@accordo/shipping';
import request from 'supertest';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;
type Agent = Awaited<ReturnType<ReturnType<typeof verifiedUserFactory>>>['agent'];
const SECRET = 'test-webhook-secret';

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

async function stepUp(agent: Agent, email: string) {
  await agent.post('/api/v1/auth/step-up/email-code').set('origin', WEB).expect(204);
  const code = /(\d{6}) è il tuo codice/.exec(env.emails.last(email)?.subject ?? '')?.[1];
  await agent.post('/api/v1/auth/step-up').set('origin', WEB).send({ emailCode: code }).expect(200);
}

describe('checkout', () => {
  it('computes the amounts and lets only one of two concurrent buyers through', async () => {
    const s = await seller();
    const l = await listing(s.id);
    const [a, b] = await Promise.all([user('primo'), user('secondo')]);
    const results = await Promise.all(
      [a, b].map((u) => checkout(u.agent, { listingId: l.id, deliveryMethod: 'HAND_DELIVERY' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const ok = results.find((r) => r.status === 201)?.body as CheckoutResponse;
    // 120 € hand delivery: fee 4% + 0.50 = 5.30 € (SPEC §6.3 table).
    expect(ok.amounts).toMatchObject({
      itemPriceCents: 12_000,
      buyerFeeCents: 530,
      totalCents: 12_530,
    });
    expect(ok).toMatchObject({
      provider: 'fake',
      clientSecret: expect.stringMatching(/^fake_pi_/),
    });
    expect(results.find((r) => r.status === 409)?.body.code).toBe('LISTING_NOT_AVAILABLE');
  });

  it('replays the same Idempotency-Key with the same response and rejects a different body', async () => {
    const s = await seller();
    const l = await listing(s.id);
    const b = await user('acquirente');
    const body = { listingId: l.id, deliveryMethod: 'HAND_DELIVERY' };
    const first = await checkout(b.agent, body, 'same-key-123').expect(201);
    const again = await checkout(b.agent, body, 'same-key-123').expect(201);
    expect(again.body.orderId).toBe(first.body.orderId);
    expect(await db.order.count({ where: { listingId: l.id } })).toBe(1);
    const other = await checkout(
      b.agent,
      { ...body, deliveryMethod: 'SHIPPING_SELF' },
      'same-key-123',
    );
    expect([other.status, other.body.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    expect((await b.agent.post('/api/v1/orders').set('origin', WEB).send(body)).body.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('refuses own listings, missing protected payment and delivery methods not offered', async () => {
    const s = await seller();
    const b = await user('acquirente');
    expect(
      (
        await checkout(s.agent, {
          listingId: (await listing(s.id)).id,
          deliveryMethod: 'HAND_DELIVERY',
        })
      ).body.code,
    ).toBe('ORDER_NOT_ALLOWED');
    const unprotected = await listing(s.id, { protectedPaymentEnabled: false });
    expect(
      (await checkout(b.agent, { listingId: unprotected.id, deliveryMethod: 'HAND_DELIVERY' }))
        .status,
    ).toBe(409);
    const handOnly = await listing(s.id, { shippingSelf: false });
    expect(
      (await checkout(b.agent, { listingId: handOnly.id, deliveryMethod: 'SHIPPING_SELF' })).body
        .code,
    ).toBe('DELIVERY_NOT_AVAILABLE');
    expect(
      (await checkout(b.agent, { listingId: handOnly.id, deliveryMethod: 'SHIPPING_INTEGRATED' }))
        .body.code,
    ).toBe('DELIVERY_NOT_AVAILABLE');
  });

  it('refuses orders between accounts that signed in from the same browser (SPEC §13.7)', async () => {
    const s = await seller();
    const b = await user('collegato');
    const l = await listing(s.id);
    await db.knownDevice.createMany({
      data: [s.id, b.id].map((userId) => ({ userId, deviceIdHash: 'shared-browser' })),
    });
    const res = await checkout(b.agent, { listingId: l.id, deliveryMethod: 'HAND_DELIVERY' });
    expect([res.status, res.body.code]).toEqual([403, 'ORDER_LINKED_ACCOUNTS']);
  });
});

describe('webhooks', () => {
  const post = (body: string, signature: string) =>
    request(env.app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('x-fake-signature', signature)
      .send(body);

  it('verifies the signature on the raw body and stores a duplicate only once', async () => {
    const body = fakeWebhookBody({ kind: 'account.updated', accountId: 'fake_acct_x' });
    await post(body, signFakeWebhook(body, 'wrong-secret')).expect(400);
    await post(`${body} `, signFakeWebhook(body, SECRET)).expect(400); // body altered
    const first = await post(body, signFakeWebhook(body, SECRET)).expect(200);
    const second = await post(body, signFakeWebhook(body, SECRET)).expect(200);
    expect([first.body.duplicate, second.body.duplicate]).toEqual([false, true]);
    const { id } = JSON.parse(body) as { id: string };
    expect(await db.webhookEvent.count({ where: { eventId: id } })).toBe(1);
    expect(
      await db.outboxEvent.count({ where: { type: 'webhook.received', aggregateId: id } }),
    ).toBe(1);
  });
});

describe('order lifecycle', () => {
  it('hand delivery: code shown after step-up, 6-digit verification completes the order', async () => {
    const s = await seller();
    const l = await listing(s.id);
    const b = await user('acquirente');
    const { orderId, amounts } = (
      await checkout(b.agent, { listingId: l.id, deliveryMethod: 'HAND_DELIVERY' }).expect(201)
    ).body as CheckoutResponse;
    await pay(orderId, amounts.totalCents);
    const detail = (await b.agent.get(`/api/v1/orders/${orderId}`).expect(200)).body as OrderDetail;
    expect(detail).toMatchObject({ status: 'HANDOVER_PENDING', role: 'BUYER' });
    expect(detail.actions).toContain('showHandoverCode');
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('RESERVED');

    expect((await b.agent.get(`/api/v1/orders/${orderId}/handover-code`)).body.code).toBe(
      'STEP_UP_REQUIRED',
    );
    await stepUp(b.agent, b.email);
    const { code } = (await b.agent.get(`/api/v1/orders/${orderId}/handover-code`).expect(200))
      .body;
    expect(code).toMatch(/^\d{6}$/);
    // The seller never gets the code (step-up first, then BUYER_ONLY).
    expect((await s.agent.get(`/api/v1/orders/${orderId}/handover-code`)).status).not.toBe(200);

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const bad = await s.agent
      .post(`/api/v1/orders/${orderId}/handover/verify`)
      .set('origin', WEB)
      .send({ code: wrong });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([422, 'HANDOVER_WRONG_CODE', '4']);
    const done = (
      await s.agent
        .post(`/api/v1/orders/${orderId}/handover/verify`)
        .set('origin', WEB)
        .send({ code })
        .expect(200)
    ).body as OrderDetail;
    expect(done.status).toBe('COMPLETED');
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('SOLD');
    const effects = await db.outboxEvent.findMany({
      where: { aggregateId: orderId, type: 'order.effects' },
    });
    expect(JSON.stringify(effects.map((e) => e.payload))).toContain('TRANSFER_TO_SELLER');
    expect(done.timeline.map((e) => e.toStatus)).toEqual([
      'CHECKOUT_PENDING',
      'HANDOVER_PENDING',
      'COMPLETED',
    ]);
  });

  it('self shipping: tracking validated, receipt confirmed with step-up, private to the parties', async () => {
    const s = await seller();
    const l = await listing(s.id);
    const b = await user('acquirente');
    const stranger = await user('curioso');
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
    const noAddress = await checkout(b.agent, { listingId: l.id, deliveryMethod: 'SHIPPING_SELF' });
    expect(noAddress.body.code).toBe('ADDRESS_REQUIRED');
    const { orderId, amounts } = (
      await checkout(b.agent, {
        listingId: l.id,
        deliveryMethod: 'SHIPPING_SELF',
        addressId: address.id,
      }).expect(201)
    ).body as CheckoutResponse;
    expect(amounts).toMatchObject({ shippingPriceCents: 1000, sellerNetCents: 13_000 });
    await stranger.agent.get(`/api/v1/orders/${orderId}`).expect(404);
    // Before payment the seller doesn't see the address.
    expect(
      (await s.agent.get(`/api/v1/orders/${orderId}`).expect(200)).body.shippingAddress,
    ).toBeNull();
    await pay(orderId, amounts.totalCents);
    expect(
      (await s.agent.get(`/api/v1/orders/${orderId}`).expect(200)).body.shippingAddress,
    ).toMatchObject({ fullName: 'Bea Rossi' });

    await s.agent
      .post(`/api/v1/orders/${orderId}/ship`)
      .set('origin', WEB)
      .send({ carrier: 'BRT', trackingNumber: '12' })
      .expect(400);
    await b.agent
      .post(`/api/v1/orders/${orderId}/ship`)
      .set('origin', WEB)
      .send({ carrier: 'BRT', trackingNumber: 'BRT123456789' })
      .expect(403);
    const shipped = (
      await s.agent
        .post(`/api/v1/orders/${orderId}/ship`)
        .set('origin', WEB)
        .send({ carrier: 'BRT', trackingNumber: 'brt123456789' })
        .expect(201)
    ).body as OrderDetail;
    expect(shipped).toMatchObject({
      status: 'SHIPPED',
      shipments: [{ carrier: 'BRT', trackingNumber: 'BRT123456789' }],
    });
    expect(shipped.deadlines.autoCompleteAt).not.toBeNull();

    const confirm = () =>
      b.agent
        .post(`/api/v1/orders/${orderId}/confirm-receipt`)
        .set('origin', WEB)
        .set('idempotency-key', `confirm-${orderId}`);
    expect((await confirm()).body.code).toBe('STEP_UP_REQUIRED');
    await stepUp(b.agent, b.email);
    expect((await confirm().expect(201)).body.status).toBe('COMPLETED');
    expect((await confirm().expect(201)).body.status).toBe('COMPLETED'); // replay
  });

  it('cancellation by the seller and by mutual agreement refunds the buyer', async () => {
    const s = await seller();
    const b = await user('acquirente');
    const one = await listing(s.id);
    const two = await listing(s.id);
    const o1 = (await checkout(b.agent, { listingId: one.id, deliveryMethod: 'HAND_DELIVERY' }))
      .body as CheckoutResponse;
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
    const o2 = (
      await checkout(b.agent, {
        listingId: two.id,
        deliveryMethod: 'SHIPPING_SELF',
        addressId: address.id,
      })
    ).body as CheckoutResponse;
    await pay(o1.orderId, o1.amounts.totalCents);
    await pay(o2.orderId, o2.amounts.totalCents);

    await b.agent
      .post(`/api/v1/orders/${o1.orderId}/cancel`)
      .set('origin', WEB)
      .send({})
      .expect(403);
    // Hand delivery can't be cancelled unilaterally: only by agreement.
    const requested = (
      await b.agent
        .post(`/api/v1/orders/${o1.orderId}/cancel-requests`)
        .set('origin', WEB)
        .send({ reason: 'Non riesco a venire' })
        .expect(201)
    ).body as OrderDetail;
    expect(requested.cancelRequest).toMatchObject({ byMe: true });
    await b.agent
      .post(`/api/v1/orders/${o1.orderId}/cancel-requests/accept`)
      .set('origin', WEB)
      .expect(409);
    expect(
      (
        await s.agent
          .post(`/api/v1/orders/${o1.orderId}/cancel-requests/accept`)
          .set('origin', WEB)
          .expect(201)
      ).body.status,
    ).toBe('CANCELLED');
    expect((await db.listing.findUniqueOrThrow({ where: { id: one.id } })).status).toBe('ACTIVE');
    const refund = await db.outboxEvent.findFirst({
      where: { aggregateId: o1.orderId, type: 'order.effects' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(refund?.payload)).toContain(`"amountCents":${o1.amounts.totalCents}`);

    // A paid, not yet shipped order can be cancelled by the seller (+1 cancellation).
    expect(
      (
        await s.agent
          .post(`/api/v1/orders/${o2.orderId}/cancel`)
          .set('origin', WEB)
          .send({})
          .expect(201)
      ).body.status,
    ).toBe('CANCELLED');
    expect(
      (await db.userReputation.findUniqueOrThrow({ where: { userId: s.id } }))
        .sellerCancellations12m,
    ).toBe(1);
  });
});

describe('integrated shipping', () => {
  const addressFor = (userId: string, type: 'SHIPPING' | 'SENDER') =>
    db.address.create({
      data: {
        userId,
        type,
        fullName: 'Persona Prova',
        line1: 'Via Roma 1',
        cap: '20121',
        comuneId: '015146',
        phone: '3331234567',
      },
    });

  it('needs a parcel size and the seller sender address; pickup points must exist near the CAP', async () => {
    const s = await seller();
    const b = await user('acquirente');
    const home = await addressFor(b.id, 'SHIPPING');
    const l = await listing(s.id, { shippingIntegrated: true, parcelSize: 'L' });
    const body = { listingId: l.id, deliveryMethod: 'SHIPPING_INTEGRATED', addressId: home.id };
    expect((await checkout(b.agent, body)).body.code).toBe('DELIVERY_NOT_AVAILABLE'); // no sender address
    await addressFor(s.id, 'SENDER');
    const points = (await b.agent.get('/api/v1/shipping/service-points?cap=00184').expect(200))
      .body;
    expect(points).toHaveLength(3);
    const wrong = await checkout(b.agent, {
      ...body,
      servicePointId: 'nope',
      servicePointCap: '00184',
    });
    expect([wrong.status, wrong.body.code]).toEqual([422, 'SERVICE_POINT_NOT_FOUND']);
    const ok = (
      await checkout(b.agent, {
        ...body,
        servicePointId: points[1].id,
        servicePointCap: '00184',
      }).expect(201)
    ).body as CheckoutResponse;
    // 120 € + parcel L 12.90 € + fee 5.30 € (SPEC §6.3/§7.1).
    expect(ok.amounts).toMatchObject({
      shippingPriceCents: 1290,
      totalCents: 12_000 + 1290 + 530,
      sellerNetCents: 12_000,
    });
    const order = await db.order.findUniqueOrThrow({ where: { id: ok.orderId } });
    expect(order.servicePoint).toMatchObject({ id: points[1].id, cap: '00184' });
  });

  it('tracking webhooks: HMAC verified, stored once, then queued; dev advance uses the same path', async () => {
    const post = (path: string, body: string, signature: string) =>
      request(env.app.getHttpServer())
        .post(`/api/v1/webhooks/${path}`)
        .set('content-type', 'application/json')
        .set(MOCK_SIGNATURE_HEADER, signature)
        .send(body);
    const body = mockWebhookBody([
      { shipmentId: 'mock_x', status: 'IN_TRANSIT', occurredAt: new Date() },
    ]);
    await post('shipping/mock', body, signMockWebhook(body, 'wrong')).expect(400);
    await post('shipping/sendcloud', body, signMockWebhook(body, 'test-shipping-secret')).expect(
      404,
    );
    expect(
      (await post('shipping/mock', body, signMockWebhook(body, 'test-shipping-secret')).expect(200))
        .body.duplicate,
    ).toBe(false);
    expect(
      (await post('shipping/mock', body, signMockWebhook(body, 'test-shipping-secret')).expect(200))
        .body.duplicate,
    ).toBe(true);
    expect(await db.webhookEvent.count({ where: { provider: 'shipping:mock' } })).toBe(1);

    // Self shipping: the seller's tracking is registered with the tracking provider.
    const s = await seller();
    const b = await user('acquirente');
    const home = await addressFor(b.id, 'SHIPPING');
    const l = await listing(s.id);
    const { orderId, amounts } = (
      await checkout(b.agent, {
        listingId: l.id,
        deliveryMethod: 'SHIPPING_SELF',
        addressId: home.id,
      })
    ).body as CheckoutResponse;
    await pay(orderId, amounts.totalCents);
    await s.agent
      .post(`/api/v1/orders/${orderId}/ship`)
      .set('origin', WEB)
      .send({ carrier: 'GLS', trackingNumber: 'GLS123456789' })
      .expect(201);
    const shipment = await db.shipment.findFirstOrThrow({ where: { orderId } });
    expect(shipment).toMatchObject({
      provider: 'mock',
      providerShipmentId: expect.stringMatching(/^track_/),
    });
    expect(
      JSON.stringify(
        (
          await db.outboxEvent.findMany({ where: { aggregateId: orderId, type: 'order.effects' } })
        ).map((e) => e.payload),
      ),
    ).toContain('REGISTER_TRACKING');
    await b.agent
      .post(`/api/v1/dev/shipments/${shipment.id}/advance`)
      .set('origin', WEB)
      .expect(200, { status: 'OUT_FOR_DELIVERY' });
    expect(await db.webhookEvent.count({ where: { provider: 'tracking:mock' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: 'shipping.updates' } })).toBe(2);
  });
});
