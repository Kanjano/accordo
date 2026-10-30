import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPrismaClient, type PrismaClient } from '@accordo/db';
import type { EmailProvider, OutgoingEmail } from '@accordo/emails';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Queue } from 'bullmq';
import type { Env } from '../src/env.js';
import { LifecycleProcessor } from '../src/lifecycle.js';
import { Notifier } from '../src/notifications/notifier.js';
import { OutboxDispatcher } from '../src/outbox.dispatcher.js';

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
    const dispatcher = new OutboxDispatcher(env, db, media, notifications);

    expect(await dispatcher.tick()).toBe(2); // the future-dated row waits
    const [name, payload, opts] = (media.add as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
      { jobId: string },
    ];
    const row = await db.outboxEvent.findFirstOrThrow({ where: { type: 'media.uploaded' } });
    expect([name, payload, opts.jobId]).toEqual(['media.uploaded', { imageId: 'i1' }, row.id]);
    expect(notifications.add).not.toHaveBeenCalled();
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
    await new OutboxDispatcher(env, db, failing, failing).tick();
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
