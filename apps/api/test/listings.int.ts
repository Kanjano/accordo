import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
let categoryId: string;
let brandId: string;

beforeAll(async () => {
  env = await startTestApp();
  db = env.app.get(PRISMA);
  verifiedUser = verifiedUserFactory(env);

  await db.regione.create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } });
  await db.provincia.create({
    data: { id: '215', sigla: 'MI', name: 'Milano', slug: 'milano', regioneId: '03' },
  });
  await db.comune.create({
    data: {
      id: '015146',
      name: 'Milano',
      slug: 'milano',
      provinciaId: '215',
      lat: 45.46,
      lng: 9.19,
    },
  });
  const dept = await db.department.create({ data: { slug: 'chitarre', name: 'Chitarre' } });
  categoryId = (
    await db.category.create({
      data: {
        departmentId: dept.id,
        slug: 'chitarre-elettriche',
        name: 'Chitarre elettriche',
        defaultParcelSize: 'L',
      },
    })
  ).id;
  brandId = (await db.brand.create({ data: { name: 'Fender', slug: 'fender' } })).id;
  await db.platformSetting.createMany({
    data: [
      { key: 'listings', value: { durationDays: 60, maxImages: 20, bumpEveryDays: 7 } },
      {
        key: 'listingChecks',
        value: {
          anomalousPriceBps: 3500,
          anomalousPriceMinSamples: 20,
          newSellerDays: 30,
          newSellerReviewAboveCents: 200_000,
        },
      },
      { key: 'bannedTerms', value: ['avorio'] },
    ],
  });
});
afterAll(() => env?.stop());

async function draft(
  agent: Awaited<ReturnType<typeof verifiedUser>>['agent'],
  over: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/api/v1/listings')
    .set('origin', WEB)
    .send({
      categoryId,
      title: 'Fender Stratocaster',
      condition: 'EXCELLENT',
      comuneId: '015146',
      brandId,
      ...over,
    })
    .expect(201);
  return res.body.id as string;
}

/** Simulates a processed photo (the worker pipeline is covered by its own tests). */
async function addProcessedImage(listingId: string, phash = randomBytes(8).toString('hex')) {
  await db.listingImage.create({
    data: { listingId, storageKey: `listings/${listingId}/img`, width: 800, height: 600, phash },
  });
}

async function complete(
  agent: Awaited<ReturnType<typeof verifiedUser>>['agent'],
  id: string,
  priceCents: number,
  description = 'Ottime condizioni, mai portata in giro.',
) {
  await agent
    .patch(`/api/v1/listings/${id}`)
    .set('origin', WEB)
    .send({ priceCents, description, handDeliveryEnabled: true })
    .expect(200);
  await addProcessedImage(id);
}

describe('listings', () => {
  it('a draft is visible only to its owner', async () => {
    const a = await verifiedUser('owner1');
    const b = await verifiedUser('other1');
    const id = await draft(a.agent);
    const own = await a.agent.get(`/api/v1/listings/${id}`).expect(200);
    expect(own.body).toMatchObject({ status: 'DRAFT', owner: { viewsCount: 0 } });
    await b.agent.get(`/api/v1/listings/${id}`).expect(404);
    await b.agent.get(`/api/v1/listings/${own.body.shortId}`).expect(404);
  });

  it("other users cannot edit, publish or attach photos to someone else's listing (anti-IDOR)", async () => {
    const a = await verifiedUser('owner2');
    const b = await verifiedUser('other2');
    const id = await draft(a.agent);
    await b.agent
      .patch(`/api/v1/listings/${id}`)
      .set('origin', WEB)
      .send({ title: 'Rubata' })
      .expect(404);
    await b.agent.post(`/api/v1/listings/${id}/publish`).set('origin', WEB).expect(404);
    await b.agent
      .post(`/api/v1/listings/${id}/images`)
      .set('origin', WEB)
      .send({ key: 'uploads/tmp/x/y.jpg' })
      .expect(404);
    await b.agent.delete(`/api/v1/listings/${id}`).set('origin', WEB).expect(404);
    const me = await a.agent.get('/api/v1/me').expect(200);
    // The upload key must belong to the caller.
    const foreign = await a.agent
      .post(`/api/v1/listings/${id}/images`)
      .set('origin', WEB)
      .send({ key: `uploads/tmp/not-${me.body.id}/file` })
      .expect(400);
    expect(foreign.body.code).toBe('INVALID_UPLOAD_KEY');
  });

  it('publication requires a complete listing', async () => {
    const { agent } = await verifiedUser('incomplete');
    const id = await draft(agent);
    const res = await agent.post(`/api/v1/listings/${id}/publish`).set('origin', WEB).expect(422);
    expect(res.body).toMatchObject({ code: 'LISTING_INCOMPLETE' });
    expect(res.body.detail.split(',')).toEqual(
      expect.arrayContaining(['priceCents', 'description', 'images']),
    );
  });

  it('rejects unknown or invalid attributes', async () => {
    const { agent } = await verifiedUser('attrs');
    const res = await agent
      .post('/api/v1/listings')
      .set('origin', WEB)
      .send({
        categoryId,
        title: 'Chitarra',
        condition: 'GOOD',
        comuneId: '015146',
        attributes: { colore: 'rosso' },
      })
      .expect(400);
    expect(res.body.code).toBe('INVALID_ATTRIBUTES');
  });

  it('a normal listing is published; an anomalous price goes to review (SPEC §13.5)', async () => {
    const seller = await verifiedUser('market');
    const sellerRow = await db.user.findUniqueOrThrow({ where: { email: seller.email } });
    await db.user.update({
      where: { id: sellerRow.id },
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    // 20 comparable listings (same category and brand) at 1 000 € from another seller.
    const other = await verifiedUser('comparables');
    const otherRow = await db.user.findUniqueOrThrow({ where: { email: other.email } });
    await db.listing.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        shortId: `CMP${String(i).padStart(5, '0')}`,
        slug: 'fender',
        sellerId: otherRow.id,
        status: 'ACTIVE' as const,
        categoryId,
        brandId,
        title: 'Fender',
        description: 'x',
        condition: 'GOOD' as const,
        priceCents: 100_000,
        comuneId: '015146',
      })),
    });

    const normal = await draft(seller.agent);
    await complete(seller.agent, normal, 80_000);
    const ok = await seller.agent
      .post(`/api/v1/listings/${normal}/publish`)
      .set('origin', WEB)
      .expect(200);
    expect(ok.body).toEqual({ status: 'ACTIVE', reasons: [] });
    expect((await db.listing.findUniqueOrThrow({ where: { id: normal } })).expiresAt).toBeTruthy();

    const cheap = await draft(seller.agent);
    await complete(seller.agent, cheap, 30_000); // 30% of the median
    const review = await seller.agent
      .post(`/api/v1/listings/${cheap}/publish`)
      .set('origin', WEB)
      .expect(200);
    expect(review.body).toEqual({ status: 'PENDING_REVIEW', reasons: ['ANOMALOUS_PRICE'] });
    expect(
      await db.outboxEvent.count({ where: { aggregateId: cheap, type: 'listing.review_pending' } }),
    ).toBe(1);
    // Not visible to the public while under review.
    await other.agent.get(`/api/v1/listings/${cheap}`).expect(404);
  });

  it("a photo matching another seller's photo sends the listing to review", async () => {
    const a = await verifiedUser('photoa');
    const b = await verifiedUser('photob');
    for (const u of [a, b])
      await db.user.update({
        where: { email: u.email },
        data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
      });
    const first = await draft(a.agent, { brandId: null });
    await a.agent
      .patch(`/api/v1/listings/${first}`)
      .set('origin', WEB)
      .send({ priceCents: 50_000, description: 'Foto originale del venditore A.' })
      .expect(200);
    await addProcessedImage(first, 'ffff0000ffff0000');
    expect(
      (await a.agent.post(`/api/v1/listings/${first}/publish`).set('origin', WEB).expect(200)).body
        .status,
    ).toBe('ACTIVE');
    const copy = await draft(b.agent, { brandId: null });
    await b.agent
      .patch(`/api/v1/listings/${copy}`)
      .set('origin', WEB)
      .send({ priceCents: 50_000, description: 'Foto presa da un altro annuncio.' })
      .expect(200);
    await addProcessedImage(copy, 'ffff0000ffff0007'); // Hamming distance 3
    const res = await b.agent
      .post(`/api/v1/listings/${copy}/publish`)
      .set('origin', WEB)
      .expect(200);
    expect(res.body).toEqual({ status: 'PENDING_REVIEW', reasons: ['REUSED_IMAGES'] });
  });

  it('banned terms send the listing to review', async () => {
    const { agent, email } = await verifiedUser('banned');
    await db.user.update({
      where: { email },
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const id = await draft(agent, { title: 'Chitarra con intarsi in avorio', brandId: null });
    await complete(agent, id, 50_000);
    const res = await agent.post(`/api/v1/listings/${id}/publish`).set('origin', WEB).expect(200);
    expect(res.body).toEqual({ status: 'PENDING_REVIEW', reasons: ['BANNED_TERMS'] });
  });

  it('a price drop on a live listing is recorded and announced through the outbox', async () => {
    const { agent, email } = await verifiedUser('dropper');
    await db.user.update({
      where: { email },
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const id = await draft(agent, { brandId: null });
    await complete(agent, id, 60_000);
    await agent.post(`/api/v1/listings/${id}/publish`).set('origin', WEB).expect(200);
    await agent
      .patch(`/api/v1/listings/${id}`)
      .set('origin', WEB)
      .send({ priceCents: 55_000 })
      .expect(200);
    expect(
      (
        await db.listingPriceHistory.findMany({
          where: { listingId: id },
          orderBy: { changedAt: 'asc' },
        })
      ).map((p) => p.priceCents),
    ).toEqual([60_000, 55_000]);
    expect(
      await db.outboxEvent.count({ where: { aggregateId: id, type: 'listing.price_dropped' } }),
    ).toBe(1);
    const zero = await agent
      .patch(`/api/v1/listings/${id}`)
      .set('origin', WEB)
      .send({ priceCents: 0 })
      .expect(400);
    expect(zero.body.code).toBe('PRICE_REQUIRED');
  });

  it('lifecycle: pause, resume, bump limit, mark sold, delete', async () => {
    const { agent, email } = await verifiedUser('cycle');
    await db.user.update({
      where: { email },
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const id = await draft(agent, { brandId: null });
    await complete(agent, id, 40_000);
    await agent.post(`/api/v1/listings/${id}/publish`).set('origin', WEB).expect(200);
    await agent.post(`/api/v1/listings/${id}/pause`).set('origin', WEB).expect(200);
    await agent.post(`/api/v1/listings/${id}/resume`).set('origin', WEB).expect(200);
    const bump = await agent.post(`/api/v1/listings/${id}/bump`).set('origin', WEB).expect(409);
    expect(bump.body.code).toBe('BUMP_TOO_SOON');
    await agent.post(`/api/v1/listings/${id}/mark-sold`).set('origin', WEB).expect(200);
    await agent.post(`/api/v1/listings/${id}/pause`).set('origin', WEB).expect(409);
    await agent.delete(`/api/v1/listings/${id}`).set('origin', WEB).expect(204);
    await agent.get(`/api/v1/listings/${id}`).expect(404);
  });
});
