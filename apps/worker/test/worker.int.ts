import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPrismaClient, type PrismaClient } from '@accordo/db';
import type { EmailProvider, OutgoingEmail } from '@accordo/emails';
import { applyOrderEvent } from '@accordo/orders';
import { FakePaymentProvider, type PaymentEvent } from '@accordo/payments';
import { createSearchClient, ensureIndexes, syncListings } from '@accordo/search';
import { MockShippingProvider } from '@accordo/shipping';
import type { S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Queue } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { Env } from '../src/env.js';
import { LifecycleProcessor } from '../src/lifecycle.js';
import { NotificationsProcessor } from '../src/notifications/notifications.processor.js';
import { Notifier } from '../src/notifications/notifier.js';
import { OffersProcessor } from '../src/offers.js';
import { OutboxDispatcher } from '../src/outbox.dispatcher.js';
import { ChargebackService, sellerReceivable } from '../src/payments/chargebacks.js';
import { NightlyChecks, OrdersSweeper } from '../src/payments/orders-sweeper.js';
import { PaymentsProcessor } from '../src/payments/payments.processor.js';
import { SavedSearchAlertsProcessor } from '../src/search/saved-search-alerts.js';
import { ShippingProcessor } from '../src/shipping/shipping.processor.js';
import { ShippingService } from '../src/shipping/shipping.service.js';

let pg: StartedPostgreSqlContainer;
let db: PrismaClient;
const env = { WEB_URL: 'http://localhost:3000', OUTBOX_POLL_MS: 1000 } as Env;
const sent: OutgoingEmail[] = [];
const email: EmailProvider = { send: async (e) => void sent.push(e) };
let sellerId: string;
let categoryId: string;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:18.6').start();
  const url = pg.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '../../../packages/db'),
    env: { ...process.env, DATABASE_MIGRATION_URL: url, DATABASE_URL: url },
    stdio: 'pipe',
  });
  db = createPrismaClient(url);
  await db.regione.create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } });
  await db.provincia.create({
    data: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
  });
  await db.comune.create({
    data: { id: '015146', name: 'Milano', slug: 'milano', provinciaId: '215' },
  });
  const dept = await db.department.create({ data: { slug: 'chitarre', name: 'Chitarre' } });
  categoryId = (
    await db.category.create({
      data: { departmentId: dept.id, slug: 'elettriche', name: 'Elettriche' },
    })
  ).id;
  sellerId = (
    await db.user.create({
      data: { name: 'Mario', email: 'mario@example.test', emailVerified: true },
    })
  ).id;
});
afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
});

const listing = (n: number, expiresAt: Date) =>
  db.listing.create({
    data: {
      shortId: `LST${String(n).padStart(5, '0')}`,
      slug: 'x',
      sellerId,
      categoryId,
      status: 'ACTIVE',
      title: `Annuncio ${n}`,
      description: 'x',
      condition: 'GOOD',
      priceCents: 1000,
      comuneId: '015146',
      expiresAt,
    },
  });

describe('outbox dispatcher', () => {
  it('publishes routed events with the outbox id as job id, marks every row processed', async () => {
    await db.outboxEvent.createMany({
      data: [
        {
          aggregateType: 'ListingImage',
          aggregateId: 'i1',
          type: 'media.uploaded',
          payload: { imageId: 'i1' },
        },
        { aggregateType: 'Listing', aggregateId: 'l1', type: 'listing.updated', payload: {} },
        {
          aggregateType: 'Listing',
          aggregateId: 'l1',
          type: 'listing.review_pending',
          payload: { listingId: 'l1' },
          availableAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const media = { add: vi.fn() } as unknown as Queue;
    const notifications = { add: vi.fn() } as unknown as Queue;
    const searchIndex = { add: vi.fn() } as unknown as Queue;
    const dispatcher = new OutboxDispatcher(env, db, media, notifications, searchIndex, {
      add: vi.fn(),
    } as unknown as Queue);

    expect(await dispatcher.tick()).toBe(2); // the future-dated row waits
    const [name, payload, opts] = (media.add as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
      { jobId: string },
    ];
    const row = await db.outboxEvent.findFirstOrThrow({ where: { type: 'media.uploaded' } });
    expect([name, payload, opts.jobId]).toEqual(['media.uploaded', { imageId: 'i1' }, row.id]);
    expect(notifications.add).not.toHaveBeenCalled();
    expect((searchIndex.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      'listing.updated',
    );
    expect(await db.outboxEvent.count({ where: { status: 'PROCESSED' } })).toBe(2);
    expect(await db.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('keeps failed rows pending with backoff and the error', async () => {
    await db.outboxEvent.deleteMany();
    await db.outboxEvent.create({
      data: {
        aggregateType: 'ListingImage',
        aggregateId: 'i2',
        type: 'media.deleted',
        payload: {},
      },
    });
    const failing = {
      add: vi.fn().mockRejectedValue(new Error('valkey down')),
    } as unknown as Queue;
    await new OutboxDispatcher(env, db, failing, failing, failing, failing).tick();
    const row = await db.outboxEvent.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Error: valkey down' });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('listing lifecycle', () => {
  it('reminds 7 days and 1 day before expiry, expires overdue listings with outbox event and notification', async () => {
    const now = new Date('2026-11-02T10:00:00Z');
    const H = 3_600_000;
    const D = 24 * H;
    const in7 = await listing(1, new Date(now.getTime() + 7 * D - 10 * 60_000));
    const in1 = await listing(2, new Date(now.getTime() + D - 30 * 60_000));
    const later = await listing(3, new Date(now.getTime() + 3 * D));
    const overdue = await listing(4, new Date(now.getTime() - H));
    const processor = new LifecycleProcessor(db, new Notifier(env, db, email));

    expect(await processor.run(now)).toEqual({ reminded: 2, expired: 1 });
    expect((await db.listing.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe(
      'EXPIRED',
    );
    expect((await db.listing.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('ACTIVE');
    expect(
      await db.outboxEvent.count({ where: { aggregateId: overdue.id, type: 'listing.expired' } }),
    ).toBe(1);
    const titles = (
      await db.notification.findMany({ where: { userId: sellerId }, orderBy: { createdAt: 'asc' } })
    ).map((n) => n.title);
    expect(titles).toEqual([
      'Il tuo annuncio scade tra 7 giorni',
      'Il tuo annuncio scade domani',
      'Annuncio scaduto',
    ]);
    expect(sent.map((e) => e.subject)).toEqual(titles);
    expect([in7.id, in1.id]).toHaveLength(2);
  });

  it('respects the email opt-out but still stores the in-app notification', async () => {
    sent.length = 0;
    await db.notificationPreference.create({
      data: { userId: sellerId, type: 'listing.lifecycle', channel: 'EMAIL', enabled: false },
    });
    const now = new Date('2026-12-01T10:00:00Z');
    await listing(5, new Date(now.getTime() - 60_000));
    const before = await db.notification.count({ where: { userId: sellerId } });
    const { expired } = await new LifecycleProcessor(db, new Notifier(env, db, email)).run(now);
    expect(expired).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
    expect(await db.notification.count({ where: { userId: sellerId } })).toBe(before + expired);
  });
});

describe('saved-search alerts', () => {
  let meili: StartedTestContainer;
  afterAll(() => meili?.stop());

  it('notifies new matching listings once, skipping the user own and older ones', async () => {
    meili = await new GenericContainer('getmeili/meilisearch:v1.56.0')
      .withEnvironment({ MEILI_MASTER_KEY: 'test_master_key_123456', MEILI_NO_ANALYTICS: 'true' })
      .withExposedPorts(7700)
      .withWaitStrategy(Wait.forHttp('/health', 7700))
      .start();
    const client = createSearchClient(
      `http://${meili.getHost()}:${meili.getMappedPort(7700)}`,
      'test_master_key_123456',
      10_000,
    );
    await ensureIndexes(client, db);
    sent.length = 0;
    const buyer = await db.user.create({
      data: { name: 'Lucia', email: 'lucia@example.test', emailVerified: true },
    });
    const savedAt = new Date(Date.now() - 3_600_000);
    const instant = await db.savedSearch.create({
      data: {
        userId: buyer.id,
        name: 'Basso Rickenbacker',
        query: { q: 'rickenbacker' },
        alertFrequency: 'INSTANT',
        createdAt: savedAt,
      },
    });
    await db.savedSearch.create({
      data: {
        userId: buyer.id,
        name: 'Riepilogo',
        query: { q: 'rickenbacker' },
        alertFrequency: 'DAILY',
        createdAt: savedAt,
      },
    });
    const make = (n: number, owner: string, publishedAt: Date) =>
      db.listing.create({
        data: {
          shortId: `RIC${String(n).padStart(5, '0')}`,
          slug: 'x',
          sellerId: owner,
          categoryId,
          status: 'ACTIVE',
          title: `Rickenbacker 4003 n. ${n}`,
          description: 'x',
          condition: 'GOOD',
          priceCents: 150_000,
          comuneId: '015146',
          publishedAt,
          bumpedAt: publishedAt,
        },
      });
    const listings = await Promise.all([
      make(1, sellerId, new Date(Date.now() - 600_000)), // new: notified
      make(2, buyer.id, new Date(Date.now() - 600_000)), // own listing: skipped
      make(3, sellerId, new Date(Date.now() - 7_200_000)), // before the search was saved
    ]);
    await syncListings(
      client,
      db,
      listings.map((l) => l.id),
    );

    const processor = new SavedSearchAlertsProcessor(db, client, new Notifier(env, db, email));
    expect(await processor.run('INSTANT')).toEqual({ notified: 1 });
    expect(sent.map((e) => [e.to, e.subject])).toEqual([
      ['lucia@example.test', 'Un nuovo annuncio per «Basso Rickenbacker»'],
    ]);
    expect(sent[0]?.html).toContain('/annunci?q=rickenbacker');
    const updated = await db.savedSearch.findUniqueOrThrow({ where: { id: instant.id } });
    expect(updated.lastNotifiedAt?.getTime()).toBe(
      Math.floor((listings[0]?.publishedAt?.getTime() as number) / 1000) * 1000,
    );
    // Nothing new since: no duplicate alert.
    expect(await processor.run('INSTANT')).toEqual({ notified: 0 });
    expect(sent).toHaveLength(1);
  });
});

describe('offers and messages', () => {
  it('expires pending offers and releases reservations not paid within the window', async () => {
    const buyer = await db.user.create({
      data: { name: 'Paola', email: 'paola@example.test', emailVerified: true },
    });
    const make = async (n: number, status: 'ACTIVE' | 'RESERVED') => {
      const l = await db.listing.create({
        data: {
          shortId: `OFR${String(n).padStart(5, '0')}`,
          slug: 'x',
          sellerId,
          categoryId,
          status,
          title: `Synth ${n}`,
          description: 'x',
          condition: 'GOOD',
          priceCents: 100_000,
          comuneId: '015146',
        },
      });
      await db.conversation.create({ data: { listingId: l.id, buyerId: buyer.id, sellerId } });
      return l;
    };
    const free = await make(1, 'ACTIVE');
    const reserved = await make(2, 'RESERVED');
    const past = new Date(Date.now() - 60_000);
    const offer = (listingId: string, status: 'PENDING' | 'ACCEPTED', expiresAt: Date) =>
      db.offer.create({
        data: {
          listingId,
          buyerId: buyer.id,
          sellerId,
          proposedById: buyer.id,
          amountCents: 80_000,
          status,
          expiresAt,
        },
      });
    const pending = await offer(free.id, 'PENDING', past);
    const fresh = await offer(free.id, 'PENDING', new Date(Date.now() + 3_600_000));
    const accepted = await offer(reserved.id, 'ACCEPTED', past);

    const processor = new OffersProcessor(db);
    expect(await processor.run(new Date())).toEqual({ expired: 2, released: 1 });
    const status = async (id: string) =>
      (await db.offer.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(pending.id), await status(fresh.id), await status(accepted.id)]).toEqual([
      'EXPIRED',
      'PENDING',
      'EXPIRED',
    ]);
    expect((await db.listing.findUniqueOrThrow({ where: { id: reserved.id } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await db.outboxEvent.count({ where: { type: 'listing.released', aggregateId: reserved.id } }),
    ).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: 'offer.expired' } })).toBe(4);
    expect(await processor.run(new Date())).toEqual({ expired: 0, released: 0 });
  });

  it('notifies a new message once per unread burst, honouring the email preference', async () => {
    sent.length = 0;
    const buyer = await db.user.create({
      data: { name: 'Carla', email: 'carla@example.test', emailVerified: true },
    });
    const l = await db.listing.findFirstOrThrow({ where: { sellerId } });
    const c = await db.conversation.create({
      data: { listingId: l.id, buyerId: buyer.id, sellerId },
    });
    const m = await db.message.create({
      data: { conversationId: c.id, senderId: buyer.id, body: 'Ciao, è disponibile?' },
    });
    const processor = new NotificationsProcessor(db, new Notifier(env, db, email));
    const job = (firstUnread: boolean) =>
      ({
        name: 'message.created',
        data: { messageId: m.id, conversationId: c.id, recipientId: sellerId, firstUnread },
      }) as never;
    await processor.process(job(true));
    await processor.process(job(false));
    expect(sent.map((e) => e.subject)).toEqual(['Nuovo messaggio da Carla']);
    await db.notificationPreference.create({
      data: { userId: sellerId, type: 'message.new', channel: 'EMAIL', enabled: false },
    });
    await processor.process(job(true));
    expect(sent).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: sellerId, type: 'message.new' } })).toBe(
      2,
    );
  });
});

describe('payments', () => {
  const pepper = 'test-pepper';
  const penv = { ...env, HANDOVER_CODE_PEPPER: pepper } as Env;
  const provider = new FakePaymentProvider('secret');
  const transfers: unknown[] = [];
  let reversalWorks = true;
  const refunds: unknown[] = [];
  const spy = Object.assign(Object.create(provider), {
    createTransfer: async (i: { idempotencyKey: string }) => {
      transfers.push(i);
      return provider.createTransfer(i as never);
    },
    refund: async (i: { idempotencyKey: string }) => {
      refunds.push(i);
      return provider.refund(i as never);
    },
    reverseTransfer: async (id: string, amount: number, key: string) => {
      if (!reversalWorks) throw new Error('balance too low');
      return provider.reverseTransfer(id, amount, key);
    },
  }) as FakePaymentProvider;
  const notifications = { add: vi.fn() } as unknown as Queue;
  const mockShipping = new MockShippingProvider('s');
  let labelCancellable = true;
  const shippingProvider = Object.assign(Object.create(mockShipping), {
    cancelShipment: async () => labelCancellable,
  }) as MockShippingProvider;
  const s3 = { send: vi.fn(async () => ({})) } as unknown as S3Client;
  let processor: PaymentsProcessor;
  let buyerId: string;
  let n = 0;

  beforeAll(async () => {
    const shippingService = new ShippingService(db, shippingProvider, shippingProvider, s3, {
      S3_BUCKET_PRIVATE: 'private',
    } as Env);
    processor = new PaymentsProcessor(
      db,
      spy,
      penv,
      notifications,
      shippingService,
      new ChargebackService(db, spy),
    );
    await db.platformSetting.createMany({
      data: [
        { key: 'orderTimings', value: {} },
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
      ],
      skipDuplicates: true,
    });
    await db.paymentAccount.create({
      data: {
        userId: sellerId,
        provider: 'fake',
        providerAccountId: 'fake_acct_seller',
        transfersEnabled: true,
      },
    });
    buyerId = (
      await db.user.create({
        data: { name: 'Gianni', email: 'gianni@example.test', emailVerified: true },
      })
    ).id;
    await db.address.create({
      data: {
        userId: sellerId,
        type: 'SENDER',
        fullName: 'Mario Negozio',
        line1: 'Via Dante 5',
        cap: '20121',
        comuneId: '015146',
        phone: '0212345678',
      },
    });
  });

  async function order(deliveryMethod: 'HAND_DELIVERY' | 'SHIPPING_SELF' | 'SHIPPING_INTEGRATED') {
    const l = await db.listing.create({
      data: {
        shortId: `PAY${String(++n).padStart(5, '0')}`,
        slug: 'x',
        sellerId,
        categoryId,
        status: 'ACTIVE',
        title: `Tromba ${n}`,
        description: 'x',
        condition: 'GOOD',
        priceCents: 12_000,
        comuneId: '015146',
        protectedPaymentEnabled: true,
        parcelSize: 'L',
      },
    });
    const shipping = deliveryMethod === 'HAND_DELIVERY' ? 0 : 1000;
    return db.order.create({
      data: {
        number: `26-PAY${n}`,
        transferGroup: `order_26-PAY${n}`,
        listingId: l.id,
        buyerId,
        sellerId,
        deliveryMethod,
        listingSnapshot: { title: l.title },
        shippingAddress: {
          fullName: 'Gianni Verdi',
          line1: 'Via Po 2',
          cap: '20121',
          comune: 'Milano',
          provincia: 'MI',
          phone: '3330000000',
        },
        itemPriceCents: 12_000,
        shippingPriceCents: shipping,
        buyerFeeCents: 530,
        buyerFeeVatCents: 96,
        totalCents: 12_530 + shipping,
        sellerNetCents: 12_000 + (deliveryMethod === 'SHIPPING_SELF' ? shipping : 0),
        paymentIntentId: `fake_pi_${n}`,
      },
    });
  }

  const webhook = async (event: PaymentEvent) => {
    const eventId = `evt_${Math.random()}`;
    await db.webhookEvent.create({
      data: { provider: 'fake', eventId, type: event.kind, payload: { event } as object },
    });
    const job = {
      name: 'webhook.received',
      data: { provider: 'fake', eventId },
      attemptsMade: 0,
    } as never;
    await processor.process(job);
    await processor.process(job); // redelivered: processed once
    return eventId;
  };
  const runEffects = async (orderId: string) => {
    const rows = await db.outboxEvent.findMany({
      where: { aggregateId: orderId, type: 'order.effects' },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows)
      await processor.process({ name: 'order.effects', data: r.payload } as never);
  };
  const succeeded = (o: { id: string; paymentIntentId: string | null; totalCents: number }) =>
    webhook({
      kind: 'payment.succeeded',
      paymentIntentId: o.paymentIntentId as string,
      chargeId: `ch_${o.id}`,
      amountCents: o.totalCents,
      currency: 'eur',
      orderId: o.id,
    });

  it('payment webhook → PAID once with the ledger; completion transfers with source_transaction', async () => {
    const o = await order('HAND_DELIVERY');
    const eventId = await succeeded(o);
    const paid = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(paid).toMatchObject({ status: 'HANDOVER_PENDING', chargeId: `ch_${o.id}`, version: 1 });
    expect(
      await db.ledgerTransaction.count({ where: { orderId: o.id, type: 'PAYMENT_SUCCEEDED' } }),
    ).toBe(1);
    expect(
      (await db.webhookEvent.findFirstOrThrow({ where: { eventId } })).processedAt,
    ).not.toBeNull();

    await db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        o.id,
        { type: 'HANDOVER_CODE_VERIFIED' },
        { role: 'SELLER', id: sellerId },
        { handoverPepper: pepper },
      ),
    );
    await runEffects(o.id);
    await runEffects(o.id); // retried job: still one transfer
    expect(transfers).toEqual([
      expect.objectContaining({
        amountCents: 12_000,
        destination: 'fake_acct_seller',
        sourceTransaction: `ch_${o.id}`,
        transferGroup: o.transferGroup,
        idempotencyKey: `transfer:${o.id}`,
      }),
    ]);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      payoutStatus: 'TRANSFERRED',
    });
    expect(
      await db.ledgerTransaction.count({ where: { orderId: o.id, type: 'TRANSFER_TO_SELLER' } }),
    ).toBe(1);
  });

  it('a cancelled paid order is refunded in full; ledger invariants hold', async () => {
    const o = await order('SHIPPING_SELF');
    await succeeded(o);
    await db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        o.id,
        { type: 'SELLER_CANCELLED' },
        { role: 'SELLER', id: sellerId },
        { handoverPepper: pepper },
      ),
    );
    await runEffects(o.id);
    await runEffects(o.id);
    expect(refunds).toHaveLength(1);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'CANCELLED',
      refundedCents: 13_530,
    });
    const report = await new NightlyChecks(db, new Notifier(env, db, email)).run(new Date());
    expect(report).toEqual({
      unbalancedTransactions: 0,
      closedOrdersWithPayable: 0,
      heldOver60Days: 0,
      heldOver85Days: 0,
      shippingExceptionsOver5Days: 0,
    });
  });

  it('the sweeper expires unpaid checkouts and frees the listing', async () => {
    const o = await order('HAND_DELIVERY');
    await db.order.update({
      where: { id: o.id },
      data: { nextAction: 'EXPIRE_RESERVATION', nextActionAt: new Date(Date.now() - 1000) },
    });
    const { handled } = await new OrdersSweeper(db, penv).run(new Date());
    expect(handled).toBeGreaterThanOrEqual(1);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'EXPIRED',
      nextAction: null,
    });
    // A late success on an expired order is refunded automatically.
    await succeeded(o);
    expect(refunds).toContainEqual(
      expect.objectContaining({ idempotencyKey: `late-refund:${o.id}` }),
    );
  });

  it('integrated shipping: label in the private bucket, tracking moves the order to SHIPPED and DELIVERED', async () => {
    const o = await order('SHIPPING_INTEGRATED');
    await succeeded(o);
    await runEffects(o.id);
    await runEffects(o.id); // retried: still one label
    const shipments = await db.shipment.findMany({ where: { orderId: o.id } });
    expect(shipments).toHaveLength(1);
    const [s] = shipments;
    expect(s).toMatchObject({
      status: 'LABEL_CREATED',
      carrier: 'MOCK',
      labelKey: `labels/${o.id}/${s?.id}.pdf`,
    });
    expect(s?.trackingNumber).toMatch(/^MOCK-/);
    const put = (s3.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      input: { Bucket: string; ContentType: string };
    };
    expect(put.input).toMatchObject({ Bucket: 'private', ContentType: 'application/pdf' });
    expect(
      (notifications.add as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => c[1].type === 'order.label_ready',
      ),
    ).toBe(true);

    const tracker = new ShippingProcessor(db, penv);
    const update = (status: string, at: string) =>
      tracker.apply({
        shipmentId: s?.providerShipmentId as string,
        status: status as never,
        occurredAt: at,
      });
    await update('IN_TRANSIT', '2026-11-02T09:00:00.000Z');
    await update('IN_TRANSIT', '2026-11-02T09:00:00.000Z'); // duplicate event ignored
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'SHIPPED',
    });
    await update('DELIVERED', '2026-11-03T15:00:00.000Z');
    const delivered = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(delivered).toMatchObject({ status: 'DELIVERED', nextAction: 'AUTO_COMPLETE' });
    expect(delivered.autoCompleteAt?.toISOString()).toBe('2026-11-06T15:00:00.000Z'); // +72 h
    const after = await db.shipment.findUniqueOrThrow({ where: { id: s?.id as string } });
    expect(after.status).toBe('DELIVERED');
    expect(after.events).toHaveLength(2);
  });

  it('cancels the unused label; if the carrier refuses and the seller is at fault, charges the seller', async () => {
    const o = await order('SHIPPING_INTEGRATED');
    await succeeded(o);
    await runEffects(o.id);
    labelCancellable = false;
    await db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        o.id,
        { type: 'SELLER_CANCELLED' },
        { role: 'SELLER', id: sellerId },
        { handoverPepper: pepper },
      ),
    );
    await runEffects(o.id);
    await runEffects(o.id);
    const charge = await db.ledgerTransaction.findMany({
      where: { externalRef: `label-charge:${o.id}` },
      include: { entries: true },
    });
    expect(charge).toHaveLength(1);
    expect(charge[0]?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: 'SELLER_RECEIVABLE',
          direction: 'DEBIT',
          amountCents: 1000,
          userId: sellerId,
        }),
        expect.objectContaining({
          account: 'SHIPPING_PAYABLE',
          direction: 'CREDIT',
          amountCents: 1000,
        }),
      ]),
    );
    labelCancellable = true;
    const other = await order('SHIPPING_INTEGRATED');
    await succeeded(other);
    await runEffects(other.id);
    await db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        other.id,
        { type: 'SELLER_CANCELLED' },
        { role: 'SELLER', id: sellerId },
        { handoverPepper: pepper },
      ),
    );
    await runEffects(other.id);
    expect((await db.shipment.findFirstOrThrow({ where: { orderId: other.id } })).status).toBe(
      'CANCELLED',
    );
  });

  const apply = (orderId: string, event: never, role: 'SELLER' | 'SYSTEM' = 'SYSTEM') =>
    db.$transaction((tx) =>
      applyOrderEvent(
        tx,
        orderId,
        event,
        { role, id: role === 'SELLER' ? sellerId : null },
        { handoverPepper: pepper },
      ),
    );
  const nightly = () => new NightlyChecks(db, new Notifier(env, db, email)).run(new Date());
  const zeroReport = {
    unbalancedTransactions: 0,
    closedOrdersWithPayable: 0,
    heldOver60Days: 0,
    heldOver85Days: 0,
    shippingExceptionsOver5Days: 0,
  };

  it('dispute with partial refund: refund on the item, the rest transferred, ledger balanced', async () => {
    const o = await order('SHIPPING_SELF');
    await succeeded(o);
    await apply(o.id, {
      type: 'SHIPMENT_CONFIRMED',
      carrier: 'BRT',
      trackingNumber: 'BRT1234567',
    } as never);
    await apply(o.id, { type: 'DELIVERED', deliveredAt: new Date() } as never);
    await apply(o.id, { type: 'DISPUTE_OPENED', reason: 'NOT_AS_DESCRIBED' } as never);
    await apply(o.id, { type: 'RESOLVED_PARTIAL_REFUND', refundCents: 3000 } as never);
    // An earlier test left a label charge on this seller: it is offset on this transfer.
    const owed = await sellerReceivable(db, sellerId);
    await runEffects(o.id);
    await runEffects(o.id);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'COMPLETED',
      refundedCents: 3000,
      payoutStatus: 'TRANSFERRED',
    });
    expect(transfers.at(-1)).toMatchObject({ amountCents: 13_000 - 3000 - owed });
    expect(await nightly()).toEqual(zeroReport);
  });

  it('chargeback: evidence submitted, transfer held, released when won', async () => {
    const o = await order('HAND_DELIVERY');
    await succeeded(o);
    await webhook({
      kind: 'dispute.created',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      amountCents: o.totalCents,
      reason: 'fraudulent',
      evidenceDueBy: null,
    });
    expect(
      await db.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: `dp_${o.id}` } }),
    ).toMatchObject({ status: 'under_review' });
    await apply(o.id, { type: 'HANDOVER_CODE_VERIFIED' } as never, 'SELLER');
    await runEffects(o.id);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      payoutStatus: 'ON_HOLD',
      transferredAt: null,
    });
    await webhook({
      kind: 'dispute.closed',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      status: 'won',
      amountCents: o.totalCents,
    });
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      payoutStatus: 'TRANSFERRED',
    });
    expect(await nightly()).toEqual(zeroReport);
  });

  it('chargeback lost with seller protection: the platform bears it, the seller is paid', async () => {
    const o = await order('HAND_DELIVERY');
    await succeeded(o);
    await apply(o.id, { type: 'HANDOVER_CODE_VERIFIED' } as never, 'SELLER');
    await webhook({
      kind: 'dispute.created',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      amountCents: o.totalCents,
      reason: 'fraudulent',
      evidenceDueBy: null,
    });
    await runEffects(o.id); // completion effects: transfer held by the open chargeback
    await webhook({
      kind: 'dispute.closed',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      status: 'lost',
      amountCents: o.totalCents,
    });
    expect(
      await db.ledgerTransaction.count({
        where: { externalRef: `chargeback:dp_${o.id}`, type: 'CHARGEBACK_LOST' },
      }),
    ).toBe(1);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      payoutStatus: 'TRANSFERRED',
    });
    expect(await nightly()).toEqual(zeroReport);
  });

  it('chargeback lost without protection before the transfer: the seller payable is cancelled', async () => {
    const o = await order('SHIPPING_SELF');
    await succeeded(o);
    await webhook({
      kind: 'dispute.created',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      amountCents: o.totalCents,
      reason: 'fraudulent',
      evidenceDueBy: null,
    });
    await webhook({
      kind: 'dispute.closed',
      disputeId: `dp_${o.id}`,
      chargeId: `ch_${o.id}`,
      status: 'lost',
      amountCents: o.totalCents,
    });
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      payoutStatus: 'REVERSED',
    });
    const payable = await db.ledgerEntry.findMany({
      where: { account: 'SELLER_PAYABLE', transaction: { orderId: o.id } },
    });
    const balance = payable.reduce(
      (n, e) => n + (e.direction === 'CREDIT' ? e.amountCents : -e.amountCents),
      0,
    );
    expect(balance).toBe(0);
    expect(await nightly()).toEqual(zeroReport);
  });

  it('refund after the transfer: reversal, or a seller credit offset on the next transfer', async () => {
    const done = async () => {
      const o = await order('HAND_DELIVERY');
      await succeeded(o);
      await apply(o.id, { type: 'HANDOVER_CODE_VERIFIED' } as never, 'SELLER');
      await runEffects(o.id);
      return o;
    };
    const refundEffect = (orderId: string, amountCents: number, key: string) =>
      processor.process({
        name: 'order.effects',
        data: {
          orderId,
          eventId: key,
          effects: [{ type: 'REFUND', amountCents, includesBuyerFee: false }],
        },
      } as never);

    const a = await done();
    await refundEffect(a.id, 2000, 'admin-1');
    expect(await sellerReceivable(db, sellerId)).toBe(0); // reversed
    reversalWorks = false;
    const b = await done();
    await refundEffect(b.id, 2000, 'admin-2');
    expect(await sellerReceivable(db, sellerId)).toBe(2000); // the seller owes it
    reversalWorks = true;
    const c = await done(); // next transfer is net of the credit
    expect(transfers.at(-1)).toMatchObject({ amountCents: 12_000 - 2000 });
    expect(await sellerReceivable(db, sellerId)).toBe(0);
    expect(await db.order.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      payoutStatus: 'TRANSFERRED',
    });
    expect((await nightly()).unbalancedTransactions).toBe(0);
  });
});
