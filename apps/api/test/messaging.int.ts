import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@accordo/db';
import type { ConversationDetail, MessageItem, OfferItem } from '@accordo/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;
let baseUrl: string;
type Agent = Awaited<ReturnType<ReturnType<typeof verifiedUserFactory>>>['agent'];

beforeAll(async () => {
  env = await startTestApp();
  await env.app.listen(0);
  baseUrl = `http://127.0.0.1:${(env.app.getHttpServer().address() as AddressInfo).port}`;
  db = env.app.get(PRISMA);
  verifiedUser = verifiedUserFactory(env);
  await db.regione.create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } });
  await db.provincia.create({
    data: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
  });
  await db.comune.create({
    data: { id: '015146', name: 'Milano', slug: 'milano', provinciaId: '215' },
  });
  const dept = await db.department.create({ data: { slug: 'synth', name: 'Synth' } });
  categoryId = (
    await db.category.create({
      data: { departmentId: dept.id, slug: 'synth-analogici', name: 'x' },
    })
  ).id;
  await db.platformSetting.create({
    data: {
      key: 'offers',
      value: {
        expiryHours: 48,
        minPercent: 50,
        acceptedCheckoutHours: 24,
        maxActivePerBuyerAndListing: 3,
      },
    },
  });
});
afterAll(() => env?.stop());

let n = 0;
async function user(name: string) {
  const u = await verifiedUser(`${name}${++n}`);
  const row = await db.user.findUniqueOrThrow({ where: { email: u.email } });
  return { ...u, id: row.id };
}

const listing = (sellerId: string, over: Record<string, unknown> = {}) =>
  db.listing.create({
    data: {
      shortId: `M${String(++n).padStart(7, '0')}`,
      slug: 'moog',
      sellerId,
      categoryId,
      status: 'ACTIVE',
      title: 'Moog Minimoog Model D',
      description: 'Perfetto.',
      condition: 'EXCELLENT',
      priceCents: 400_000,
      comuneId: '015146',
      isNegotiable: true,
      protectedPaymentEnabled: true,
      publishedAt: new Date(),
      ...over,
    },
  });

const post = (agent: Agent, path: string, body: unknown = {}) =>
  agent
    .post(`/api/v1${path}`)
    .set('origin', WEB)
    .send(body as object);

async function open(buyer: Agent, listingId: string, body = 'Ciao, è ancora disponibile?') {
  const res = await post(buyer, '/conversations', { listingId, body }).expect(201);
  return res.body.id as string;
}

const messages = async (agent: Agent, id: string) =>
  (await agent.get(`/api/v1/conversations/${id}/messages`).expect(200)).body.items as MessageItem[];

describe('conversations', () => {
  it('opens one conversation per listing and buyer, private to its two parties', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const stranger = await user('estraneo');
    const l = await listing(seller.id);
    const id = await open(buyer.agent, l.id);
    expect(await open(buyer.agent, l.id, 'Secondo messaggio')).toBe(id);
    await post(seller.agent, '/conversations', { listingId: l.id, body: 'x' }).expect(409);

    const list = (await seller.agent.get('/api/v1/conversations').expect(200)).body.items;
    expect(list[0]).toMatchObject({ id, role: 'SELLER', unread: 2 });
    expect((await seller.agent.get('/api/v1/conversations/unread-count')).body).toEqual({
      count: 1,
    });
    await stranger.agent.get(`/api/v1/conversations/${id}/messages`).expect(404);
    await post(stranger.agent, `/conversations/${id}/messages`, { body: 'x' }).expect(404);

    await post(seller.agent, `/conversations/${id}/read`).expect(204);
    expect((await seller.agent.get('/api/v1/conversations/unread-count')).body.count).toBe(0);
    expect((await messages(buyer.agent, id)).every((m) => m.readAt)).toBe(true);

    await post(seller.agent, `/conversations/${id}/archive`).expect(204);
    expect((await seller.agent.get('/api/v1/conversations').expect(200)).body.items).toEqual([]);
    await post(buyer.agent, `/conversations/${id}/messages`, { body: 'Ci sei?' }).expect(201);
    // A new message brings the conversation back.
    expect((await seller.agent.get('/api/v1/conversations').expect(200)).body.items).toHaveLength(
      1,
    );
  });

  it('masks phones from new accounts until both parties wrote and the sender is 7 days old', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const id = await open(buyer.agent, (await listing(seller.id)).id, 'Chiamami al 333 123 4567');
    expect((await messages(buyer.agent, id))[0]).toMatchObject({
      body: 'Chiamami al [contatto nascosto]',
      flags: ['PHONE'],
      warn: false,
    });
    await post(seller.agent, `/conversations/${id}/messages`, { body: 'Certo' }).expect(201);
    // Both wrote, but the buyer's account is new: still masked.
    await post(buyer.agent, `/conversations/${id}/messages`, { body: '333 123 4567' }).expect(201);
    expect((await messages(buyer.agent, id))[0]?.body).toBe('[contatto nascosto]');
    await db.user.update({
      where: { id: buyer.id },
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await post(buyer.agent, `/conversations/${id}/messages`, { body: '333 123 4567' }).expect(201);
    expect((await messages(buyer.agent, id))[0]?.body).toBe('333 123 4567');
  });

  it('flags IBANs with a warning and limits accounts that spread them', async () => {
    const scammer = await user('truffatore');
    const iban = 'Pagami con bonifico su IT60 X054 2811 1010 0000 0123 456';
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const seller = await user('vittima');
      const id = await open(scammer.agent, (await listing(seller.id)).id, 'Ciao');
      await post(scammer.agent, `/conversations/${id}/messages`, { body: iban }).expect(201);
      ids.push(id);
    }
    const [last] = await messages(scammer.agent, ids[0] as string);
    expect(last).toMatchObject({ warn: true });
    expect(last?.flags).toEqual(expect.arrayContaining(['IBAN', 'OFF_PLATFORM_PAYMENT']));
    expect((await db.user.findUniqueOrThrow({ where: { id: scammer.id } })).status).toBe('LIMITED');
    expect(
      await db.auditLog.count({ where: { action: 'user.limited', entityId: scammer.id } }),
    ).toBe(1);
    // Limited: can still reply, cannot open new conversations.
    await post(scammer.agent, `/conversations/${ids[0]}/messages`, { body: 'ok' }).expect(201);
    const other = await user('altro');
    const res = await post(scammer.agent, '/conversations', {
      listingId: (await listing(other.id)).id,
      body: 'Ciao',
    }).expect(403);
    expect(res.body.code).toBe('ACCOUNT_LIMITED');
  });

  it('stops messages when either party blocks the other, and accepts reports', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const id = await open(buyer.agent, (await listing(seller.id)).id, 'Messaggio molesto');
    const [msg] = await messages(seller.agent, id);
    await post(seller.agent, `/messages/${msg?.id}/report`, { reasonCode: 'ABUSE' }).expect(204);
    await post(buyer.agent, `/messages/${msg?.id}/report`, { reasonCode: 'ABUSE' }).expect(404);
    expect(await db.report.count({ where: { targetType: 'MESSAGE', targetId: msg?.id } })).toBe(1);

    await seller.agent.put(`/api/v1/users/${buyer.id}/block`).set('origin', WEB).expect(204);
    const res = await post(buyer.agent, `/conversations/${id}/messages`, { body: 'x' }).expect(403);
    expect(res.body.code).toBe('USER_BLOCKED');
    expect(
      (await buyer.agent.get(`/api/v1/conversations/${id}`).expect(200)).body as ConversationDetail,
    ).toMatchObject({ blocked: true });
  });
});

describe('realtime', () => {
  const connect = async (email: string) => {
    const res = await request(env.app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('origin', WEB)
      .send({ email, password: 'una-password-lunga' })
      .expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const socket = io(baseUrl, {
      path: '/ws',
      transports: ['websocket'],
      extraHeaders: { cookie, origin: WEB },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    return socket;
  };

  it('delivers new messages to both parties and refuses anonymous sockets', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const socket = await connect(seller.email);
    const id = await open(buyer.agent, (await listing(seller.id)).id);
    const received = new Promise<{ conversationId: string; message: MessageItem }>((resolve) =>
      socket.on('message:new', resolve),
    );
    await post(buyer.agent, `/conversations/${id}/messages`, { body: 'In tempo reale' });
    const event = await received;
    expect(event.conversationId).toBe(id);
    socket.disconnect();

    const anon: Socket = io(baseUrl, { path: '/ws', transports: ['websocket'] });
    await new Promise<void>((resolve) => anon.on('disconnect', () => resolve()));
    expect(anon.connected).toBe(false);
  });
});

describe('offers', () => {
  it('validates the amount and the limits', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const l = await listing(seller.id);
    const low = await post(buyer.agent, `/listings/${l.id}/offers`, { amountCents: 199_999 });
    expect([low.status, low.body.code]).toEqual([422, 'OFFER_TOO_LOW']);
    for (let i = 0; i < 3; i++)
      await post(buyer.agent, `/listings/${l.id}/offers`, { amountCents: 300_000 + i }).expect(201);
    const fourth = await post(buyer.agent, `/listings/${l.id}/offers`, { amountCents: 300_000 });
    expect([fourth.status, fourth.body.code]).toEqual([409, 'TOO_MANY_OFFERS']);
    const fixed = await listing(seller.id, { isNegotiable: false });
    expect(
      (await post(buyer.agent, `/listings/${fixed.id}/offers`, { amountCents: 300_000 })).body.code,
    ).toBe('OFFERS_NOT_ALLOWED');
  });

  it('counter → accept reserves the listing for 24 hours to the buyer', async () => {
    const seller = await user('venditore');
    const buyer = await user('acquirente');
    const rival = await user('rivale');
    const l = await listing(seller.id);
    const first = (await post(buyer.agent, `/listings/${l.id}/offers`, { amountCents: 300_000 }))
      .body as OfferItem;
    await post(buyer.agent, `/offers/${first.id}/accept`).expect(403); // the proposer can't accept
    const rivalOffer = (
      await post(rival.agent, `/listings/${l.id}/offers`, { amountCents: 320_000 }).expect(201)
    ).body as OfferItem;

    const counter = (
      await post(seller.agent, `/offers/${first.id}/counter`, { amountCents: 350_000 }).expect(201)
    ).body as OfferItem;
    expect(counter).toMatchObject({ proposedById: seller.id, parentOfferId: first.id });
    await post(seller.agent, `/offers/${counter.id}/withdraw`).expect(201);
    const counter2 = (
      await post(seller.agent, `/offers/${first.id}/counter`, { amountCents: 340_000 })
    ).body;
    expect(counter2.code).toBe('OFFER_NOT_PENDING'); // already countered

    const second = (await post(buyer.agent, `/listings/${l.id}/offers`, { amountCents: 330_000 }))
      .body as OfferItem;
    const accepted = (await post(seller.agent, `/offers/${second.id}/accept`).expect(201))
      .body as OfferItem;
    expect(accepted.status).toBe('ACCEPTED');
    const hours = (Date.parse(accepted.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('RESERVED');
    expect(
      await db.outboxEvent.count({ where: { aggregateId: l.id, type: 'listing.reserved' } }),
    ).toBe(1);

    // The listing is no longer available to anyone else.
    const late = await post(seller.agent, `/offers/${rivalOffer.id}/accept`);
    expect([late.status, late.body.code]).toEqual([409, 'LISTING_NOT_AVAILABLE']);
    expect((await db.offer.findUniqueOrThrow({ where: { id: rivalOffer.id } })).status).toBe(
      'PENDING',
    );
    expect(
      (await post(rival.agent, `/listings/${l.id}/offers`, { amountCents: 390_000 })).body.code,
    ).toBe('LISTING_NOT_AVAILABLE');

    // The conversation shows the offer history as messages.
    const [conversation] = (await buyer.agent.get('/api/v1/conversations').expect(200)).body.items;
    const events = (await messages(buyer.agent, conversation.id))
      .filter((m) => m.type === 'OFFER')
      .map((m) => m.body)
      .reverse();
    expect(events).toEqual(['created', 'countered', 'withdrawn', 'created', 'accepted']);
    const mine = (await buyer.agent.get('/api/v1/me/offers?role=buyer').expect(200)).body;
    expect(mine[0]).toMatchObject({ id: second.id, conversationId: conversation.id });
  });
});
