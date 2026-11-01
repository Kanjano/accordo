import type { PrismaClient } from '@accordo/db';
import type { ListingDetail, MyShop, ShopPublic } from '@accordo/shared';
import request from 'supertest';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { ShopsService } from '../src/modules/shops/shops.service.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;
const DAY = 86_400_000;

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
  const dept = await db.department.create({ data: { slug: 'tastiere', name: 'Tastiere' } });
  categoryId = (
    await db.category.create({ data: { departmentId: dept.id, slug: 'synth', name: 'Synth' } })
  ).id;
  await db.platformSetting.createMany({
    data: [
      { key: 'listings', value: { durationDays: 60, maxImages: 20, bumpEveryDays: 7 } },
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

const listing = (sellerId: string, priceCents: number) =>
  db.listing.create({
    data: {
      shortId: `S${String(++n).padStart(7, '0')}`,
      slug: 'moog',
      sellerId,
      categoryId,
      status: 'ACTIVE',
      title: 'Moog Subsequent 37',
      description: 'Synth analogico.',
      condition: 'GOOD',
      priceCents,
      comuneId: '015146',
      publishedAt: new Date(),
    },
  });

const APPLY = {
  name: 'Musica Prova',
  legalName: 'Musica Prova S.r.l.',
  vatNumber: '12345678903',
  email: 'info@musicaprova.example',
  phone: '02 1234567',
  addressLine: 'Via Torino 10',
  cap: '20123',
  comuneId: '015146',
  returnPolicy: 'Recesso entro 14 giorni dalla consegna con rimborso completo.',
  warrantyInfo: 'Garanzia legale di 24 mesi sul nuovo e 12 sull’usato.',
  traderSelfCertified: true,
};
const detail = async (id: string) =>
  (await request(env.app.getHttpServer()).get(`/api/v1/listings/${id}`).expect(200))
    .body as ListingDetail;

describe('shop application and verification (SPEC §3.8)', () => {
  it('rejects a bad VAT check digit and requires the self-certification', async () => {
    const u = await user('negozio');
    await u.agent
      .post('/api/v1/shops')
      .set('origin', WEB)
      .send({ ...APPLY, vatNumber: '12345678901' })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('VAT_INVALID'));
    await u.agent
      .post('/api/v1/shops')
      .set('origin', WEB)
      .send({ ...APPLY, traderSelfCertified: false })
      .expect(400);
  });

  it('the application labels the listings as professional; staff verification lists the shop', async () => {
    const u = await user('negozio');
    const l = await listing(u.id, 50_000);
    const before = await detail(l.id);
    expect(before.sellerType).toBe('PRIVATE');
    expect(before.seller.shop).toBeNull();

    const shop = (await u.agent.post('/api/v1/shops').set('origin', WEB).send(APPLY).expect(201))
      .body as MyShop;
    expect(shop.status).toBe('PENDING');
    await u.agent
      .post('/api/v1/shops')
      .set('origin', WEB)
      .send(APPLY)
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('SHOP_EXISTS'));

    const after = await detail(l.id);
    expect(after.sellerType).toBe('BUSINESS');
    expect(after.seller.shop).toMatchObject({
      legalName: 'Musica Prova S.r.l.',
      vatNumber: '12345678903',
      address: 'Via Torino 10, 20123 Milano (MI)',
      verified: false,
    });
    // Not in the directory nor on a storefront before verification.
    const http = request(env.app.getHttpServer());
    expect((await http.get('/api/v1/shops').expect(200)).body.total).toBe(0);
    await http.get(`/api/v1/shops/${shop.slug}`).expect(404);

    // Staff only.
    await u.agent.get('/api/v1/admin/shops').expect(403);
    const service = env.app.get(ShopsService);
    const staff = await db.user.create({
      data: { name: 'Mod', email: `mod${++n}@example.test`, role: 'moderator' },
    });
    expect((await service.adminList('PENDING')).map((s) => s.id)).toContain(shop.id);
    await service.reject(staff.id, shop.id, 'La partita IVA non corrisponde alla ragione sociale.');
    expect((await u.agent.get('/api/v1/me/shop').expect(200)).body).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'La partita IVA non corrisponde alla ragione sociale.',
    });
    // Corrected → back in the queue.
    await u.agent
      .patch('/api/v1/me/shop')
      .set('origin', WEB)
      .send({ legalName: 'Musica Prova S.r.l.s.' })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('PENDING'));

    await service.verify(staff.id, shop.id);
    expect(
      await db.outboxEvent.count({ where: { type: 'shop.verified', aggregateId: shop.id } }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: shop.id } })).toBe(3);
    const dir = (await http.get('/api/v1/shops?region=lombardia').expect(200)).body;
    expect(dir.items).toEqual([expect.objectContaining({ slug: shop.slug, activeListings: 1 })]);
    expect((await http.get('/api/v1/shops?region=sicilia').expect(200)).body.total).toBe(0);
    const pub = (await http.get(`/api/v1/shops/${shop.slug}`).expect(200)).body as ShopPublic;
    expect(pub.legal.vatNumber).toBe('12345678903');
    expect((await detail(l.id)).seller.shop?.verified).toBe(true);

    // Verified legal data is locked; the storefront data is not.
    await u.agent
      .patch('/api/v1/me/shop')
      .set('origin', WEB)
      .send({ vatNumber: '01234567897' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('SHOP_LEGAL_LOCKED'));
    await u.agent
      .patch('/api/v1/me/shop')
      .set('origin', WEB)
      .send({ description: 'Vendita e riparazione di synth.' })
      .expect(200);
  });
});

describe('price reductions (SPEC §14.3, Omnibus)', () => {
  const history = (listingId: string, rows: Array<[number, number]>) =>
    db.listingPriceHistory.createMany({
      data: rows.map(([daysAgo, priceCents]) => ({
        listingId,
        priceCents,
        changedAt: new Date(Date.now() - daysAgo * DAY),
      })),
    });

  it('a shop shows the lowest price of the 30 days before the cut, a private seller does not', async () => {
    const shopOwner = await user('negozio');
    const shopListing = await listing(shopOwner.id, 90_000);
    await shopOwner.agent
      .post('/api/v1/shops')
      .set('origin', WEB)
      .send({ ...APPLY, vatNumber: '01234567897' })
      .expect(201);
    // 100,00 → briefly 85,00 → 100,00 → cut to 90,00 two days ago.
    await history(shopListing.id, [
      [90, 100_000],
      [20, 85_000],
      [15, 100_000],
      [2, 90_000],
    ]);
    expect((await detail(shopListing.id)).priceReduction).toMatchObject({
      previousCents: 100_000,
      lowest30dCents: 85_000,
    });

    const privateSeller = await user('privato');
    const privateListing = await listing(privateSeller.id, 90_000);
    await history(privateListing.id, [
      [10, 100_000],
      [2, 90_000],
    ]);
    expect((await detail(privateListing.id)).priceReduction).toMatchObject({
      previousCents: 100_000,
      lowest30dCents: null,
    });
  });

  it('a price edit by the seller becomes the reduction', async () => {
    const u = await user('venditore');
    const l = await listing(u.id, 40_000);
    await history(l.id, [[5, 40_000]]);
    expect((await detail(l.id)).priceReduction).toBeNull();
    await u.agent
      .patch(`/api/v1/listings/${l.id}`)
      .set('origin', WEB)
      .send({ priceCents: 36_000 })
      .expect(200);
    expect((await detail(l.id)).priceReduction?.previousCents).toBe(40_000);
  });
});
