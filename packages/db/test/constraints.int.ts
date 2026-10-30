// SPEC §10.2: constraints Prisma cannot express, verified on a real PostgreSQL 18 (Testcontainers).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index.js';

let container: StartedPostgreSqlContainer;
let db: PrismaClient;
let listingId: string;
let buyerId: string;
let sellerId: string;
let n = 0;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.6').start();
  const url = container.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '..'),
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
  const cat = await db.category.create({
    data: { departmentId: dept.id, slug: 'chitarre-elettriche', name: 'Chitarre elettriche' },
  });
  sellerId = (await db.user.create({ data: { name: 'S', email: 's@test.local' } })).id;
  buyerId = (await db.user.create({ data: { name: 'B', email: 'b@test.local' } })).id;
  listingId = (
    await db.listing.create({
      data: {
        shortId: 'AAAAAAAA',
        slug: 'x',
        sellerId,
        categoryId: cat.id,
        title: 'Chitarra',
        description: '-',
        condition: 'GOOD',
        priceCents: 10_000,
        comuneId: '015146',
      },
    })
  ).id;
});

afterAll(async () => {
  await db?.$disconnect();
  await container?.stop();
});

const orderData = (
  status: 'CHECKOUT_PENDING' | 'EXPIRED' | 'COMPLETED' | 'PAID',
  over: Record<string, number> = {},
) => {
  n++;
  return {
    number: `26-TEST${String(n).padStart(2, '0')}`,
    transferGroup: `tg_${n}`,
    listingId,
    buyerId,
    sellerId,
    status,
    deliveryMethod: 'HAND_DELIVERY' as const,
    listingSnapshot: {},
    itemPriceCents: 10_000,
    buyerFeeCents: 450,
    totalCents: 10_450,
    sellerNetCents: 10_000,
    ...over,
  };
};

describe('database constraints', () => {
  it('one active order per listing, even with concurrent checkouts', async () => {
    const results = await Promise.allSettled([
      db.order.create({ data: orderData('CHECKOUT_PENDING') }),
      db.order.create({ data: orderData('CHECKOUT_PENDING') }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // Terminal orders do not block the listing.
    await expect(db.order.create({ data: orderData('EXPIRED') })).resolves.toBeDefined();
  });

  it('order total must equal item + shipping + fee', async () => {
    await expect(
      db.order.create({ data: orderData('EXPIRED', { totalCents: 10_451 }) }),
    ).rejects.toThrow();
    await expect(
      db.order.create({ data: orderData('EXPIRED', { refundedCents: 20_000 }) }),
    ).rejects.toThrow();
  });

  it('listing price must be positive outside drafts', async () => {
    await expect(
      db.listing.update({ where: { id: listingId }, data: { priceCents: 0, status: 'ACTIVE' } }),
    ).rejects.toThrow();
    await expect(
      db.listing.update({ where: { id: listingId }, data: { priceCents: 0, status: 'DRAFT' } }),
    ).resolves.toBeDefined();
    await db.listing.update({ where: { id: listingId }, data: { priceCents: 10_000 } });
  });

  it('seller feedback can only be positive; detailed ratings are 1–5', async () => {
    const order = await db.order.create({ data: orderData('COMPLETED') });
    const base = {
      orderId: order.id,
      authorId: sellerId,
      recipientId: buyerId,
      weekKey: '2026-W44',
    };
    await expect(
      db.feedback.create({ data: { ...base, role: 'SELLER_TO_BUYER', rating: 'NEGATIVE' } }),
    ).rejects.toThrow();
    await expect(
      db.feedback.create({ data: { ...base, role: 'SELLER_TO_BUYER', rating: 'POSITIVE' } }),
    ).resolves.toBeDefined();
    await expect(
      db.feedback.create({
        data: {
          ...base,
          authorId: buyerId,
          recipientId: sellerId,
          role: 'BUYER_TO_SELLER',
          rating: 'POSITIVE',
          dsrPackaging: 6,
        },
      }),
    ).rejects.toThrow();
  });

  it('ledger amounts must be positive', async () => {
    await expect(
      db.ledgerTransaction.create({
        data: {
          type: 'TEST',
          entries: { create: [{ account: 'CASH_STRIPE', direction: 'DEBIT', amountCents: 0 }] },
        },
      }),
    ).rejects.toThrow();
  });

  it('pg_trgm fallback search index exists', async () => {
    const rows = await db.$queryRaw<
      Array<{ indexname: string }>
    >`SELECT indexname FROM pg_indexes WHERE tablename = 'Listing' AND indexname IN ('Listing_title_trgm', 'Listing_attributes_gin')`;
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'Listing_attributes_gin',
      'Listing_title_trgm',
    ]);
  });
});
