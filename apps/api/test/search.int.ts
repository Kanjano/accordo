import type { PrismaClient } from '@accordo/db';
import { createSearchClient, ensureIndexes, syncCatalog, syncListings } from '@accordo/search';
import type { SearchResult } from '@accordo/shared';
import request from 'supertest';
import { PRISMA } from '../src/modules/platform/infra.providers.js';
import { MEILI_KEY, startTestApp, type TestEnv, verifiedUserFactory, WEB } from './setup.js';

let env: TestEnv;
let db: PrismaClient;
let verifiedUser: ReturnType<typeof verifiedUserFactory>;
const ids: string[] = [];
let sellerId: string;

/** Real ISTAT codes and centroids: Monza ≈ 15 km from Milano, Bergamo ≈ 42 km. */
const COMUNI = [
  { id: '015146', name: 'Milano', provinciaId: '215', lat: 45.4642, lng: 9.19 },
  { id: '108033', name: 'Monza', provinciaId: '108', lat: 45.5845, lng: 9.2744 },
  { id: '016024', name: 'Bergamo', provinciaId: '016', lat: 45.6983, lng: 9.6773 },
];
const CONDITIONS = ['NEW', 'EXCELLENT', 'GOOD'] as const;

const search = (query: Record<string, string | string[]>) =>
  request(env.app.getHttpServer())
    .get('/api/v1/search/listings')
    .query(query)
    .expect(200)
    .then((r) => r.body as SearchResult);

beforeAll(async () => {
  env = await startTestApp({ search: true });
  db = env.app.get(PRISMA);
  verifiedUser = verifiedUserFactory(env);

  await db.regione.create({ data: { id: '03', name: 'Lombardia', slug: 'lombardia' } });
  for (const [id, sigla, name] of [
    ['215', 'MI', 'Milano'],
    ['108', 'MB', 'Monza e della Brianza'],
    ['016', 'BG', 'Bergamo'],
  ] as const)
    await db.provincia.create({
      data: { id, sigla, name, slug: sigla.toLowerCase(), regioneId: '03' },
    });
  for (const c of COMUNI) await db.comune.create({ data: { ...c, slug: c.name.toLowerCase() } });
  const dept = await db.department.create({ data: { slug: 'chitarre', name: 'Chitarre' } });
  const categories = await Promise.all(
    ['chitarre-elettriche', 'chitarre-acustiche'].map((slug, position) =>
      db.category.create({ data: { departmentId: dept.id, slug, name: slug, position } }),
    ),
  );
  const brands = await Promise.all(
    [
      ['Fender', 'fender'],
      ['Gibson', 'gibson'],
    ].map(([name, slug]) =>
      db.brand.create({ data: { name: name as string, slug: slug as string } }),
    ),
  );
  sellerId = (
    await db.user.create({
      data: {
        name: 'Venditore',
        email: 'seller@example.test',
        emailVerified: true,
        username: 'venditore',
      },
    })
  ).id;

  // 30 live listings spread over categories, brands, conditions and comuni, plus 3 not indexable.
  for (let i = 0; i < 33; i++) {
    const comune = COMUNI[i % 3] as (typeof COMUNI)[number];
    const fender = i % 2 === 0;
    const l = await db.listing.create({
      data: {
        shortId: `S${String(i).padStart(7, '0')}`,
        slug: 'x',
        sellerId,
        categoryId: (categories[i % 4 === 0 ? 1 : 0] as { id: string }).id,
        brandId: (brands[fender ? 0 : 1] as { id: string }).id,
        status: i >= 30 ? (['DRAFT', 'PAUSED', 'SOLD'] as const)[i - 30] : 'ACTIVE',
        title: fender ? `Fender Stratocaster ${i}` : `Gibson Les Paul ${i}`,
        description: 'Strumento in ottime condizioni, mai modificato.',
        condition: CONDITIONS[i % 3] as (typeof CONDITIONS)[number],
        priceCents: 10_000 + i * 1000,
        comuneId: comune.id,
        lat: comune.lat,
        lng: comune.lng,
        publishedAt: new Date(Date.now() - (33 - i) * 60_000),
        bumpedAt: new Date(Date.now() - (33 - i) * 60_000),
      },
    });
    ids.push(l.id);
  }
  const client = createSearchClient(process.env.MEILI_HOST as string, MEILI_KEY);
  await ensureIndexes(client, db);
  await syncCatalog(client, db);
  await syncListings(client, db, ids);
});
afterAll(() => env?.stop());

describe('search (Meilisearch)', () => {
  it('tolerates typos and uses the sector synonyms', async () => {
    const typo = await search({ q: 'stratocster' });
    expect(typo.degraded).toBe(false);
    expect(typo.total).toBe(15);
    expect(typo.hits.every((h) => h.title.startsWith('Fender Stratocaster'))).toBe(true);
    expect((await search({ q: 'strato' })).total).toBe(15);
    expect((await search({ q: 'lp' })).total).toBe(15);
  });

  it('indexes only ACTIVE and RESERVED listings, newest first by default', async () => {
    const all = await search({ hitsPerPage: '48' });
    expect(all.total).toBe(30);
    const dates = all.hits.map((h) => Date.parse(h.publishedAt as string));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('returns facet counts equal to the database', async () => {
    for (const filter of [{}, { region: 'lombardia', condition: 'GOOD' }]) {
      const res = await search(filter);
      const where = {
        status: 'ACTIVE' as const,
        ...('condition' in filter ? { condition: 'GOOD' as const } : {}),
      };
      const byCategory = await db.listing.groupBy({ by: ['categoryId'], where, _count: true });
      const byCondition = await db.listing.groupBy({ by: ['condition'], where, _count: true });
      const categories = await db.category.findMany();
      expect(res.facets.categorySlug).toEqual(
        Object.fromEntries(
          byCategory.map((g) => [categories.find((c) => c.id === g.categoryId)?.slug, g._count]),
        ),
      );
      expect(res.facets.condition).toEqual(
        Object.fromEntries(byCondition.map((g) => [g.condition, g._count])),
      );
      expect(res.total).toBe(byCondition.reduce((n, g) => n + g._count, 0));
    }
  });

  it('filters within 30 km of Milano and sorts by distance', async () => {
    const res = await search({
      comune: '015146',
      radiusKm: '30',
      sort: 'distance',
      hitsPerPage: '48',
    });
    expect(new Set(res.hits.map((h) => h.location.comune))).toEqual(new Set(['Milano', 'Monza']));
    expect(res.total).toBe(20);
    const km = res.hits.map((h) => h.distanceKm as number);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    expect(km.at(-1)).toBeGreaterThan(10);
    expect((await search({ comune: '015146', radiusKm: '50' })).total).toBe(30);
  });

  it('combines filters, sorts by price and paginates', async () => {
    const res = await search({
      brand: ['fender'],
      priceMin: '150',
      priceMax: '300',
      sort: 'price_asc',
      hitsPerPage: '2',
      page: '2',
    });
    expect(res.hitsPerPage).toBe(2);
    expect(res.page).toBe(2);
    const prices = res.hits.map((h) => h.priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices.every((p) => p >= 15_000 && p <= 30_000)).toBe(true);
  });

  it('suggests brands, categories and titles', async () => {
    const res = await request(env.app.getHttpServer())
      .get('/api/v1/search/suggest')
      .query({ q: 'fend' })
      .expect(200);
    expect(res.body[0]).toEqual({ kind: 'brand', label: 'Fender', path: '/marca/fender' });
    expect(res.body.length).toBeLessThanOrEqual(8);
  });

  it('rejects malformed parameters with 400', async () => {
    await request(env.app.getHttpServer())
      .get('/api/v1/search/listings')
      .query({ category: 'DROP TABLE' })
      .expect(400);
  });
});

describe('saved searches, favorites, recently viewed, following', () => {
  it('saves searches per user with anti-IDOR', async () => {
    const { agent } = await verifiedUser('cercatore');
    const { agent: other } = await verifiedUser('curioso');
    const created = await agent
      .post('/api/v1/me/saved-searches')
      .set('origin', WEB)
      .send({ name: 'Strato a Milano', query: { q: 'strato', comune: '015146', radiusKm: '30' } })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Strato a Milano', alertFrequency: 'DAILY' });
    await agent
      .post('/api/v1/me/saved-searches')
      .set('origin', WEB)
      .send({ name: 'x', query: { category: 'NOPE NOPE' } })
      .expect(400);
    await other
      .patch(`/api/v1/me/saved-searches/${created.body.id}`)
      .set('origin', WEB)
      .send({ alertFrequency: 'INSTANT' })
      .expect(404);
    await agent
      .patch(`/api/v1/me/saved-searches/${created.body.id}`)
      .set('origin', WEB)
      .send({ alertFrequency: 'INSTANT' })
      .expect(200);
    expect((await agent.get('/api/v1/me/saved-searches').expect(200)).body).toHaveLength(1);
    expect((await other.get('/api/v1/me/saved-searches').expect(200)).body).toHaveLength(0);
    await other
      .delete(`/api/v1/me/saved-searches/${created.body.id}`)
      .set('origin', WEB)
      .expect(404);
    await agent
      .delete(`/api/v1/me/saved-searches/${created.body.id}`)
      .set('origin', WEB)
      .expect(204);
  });

  it('keeps favorites idempotent and the counter exact', async () => {
    const { agent } = await verifiedUser('collezionista');
    const id = ids[0] as string;
    for (let i = 0; i < 2; i++)
      await agent.put(`/api/v1/listings/${id}/favorite`).set('origin', WEB).expect(204);
    expect((await agent.get('/api/v1/me/favorites/ids').expect(200)).body).toEqual([id]);
    expect((await db.listing.findUniqueOrThrow({ where: { id } })).favoritesCount).toBe(1);
    await agent.put(`/api/v1/listings/${ids[30]}/favorite`).set('origin', WEB).expect(404); // draft
    for (let i = 0; i < 2; i++)
      await agent.delete(`/api/v1/listings/${id}/favorite`).set('origin', WEB).expect(204);
    expect((await db.listing.findUniqueOrThrow({ where: { id } })).favoritesCount).toBe(0);
  });

  it('merges recently viewed listings newest first, skipping private ones', async () => {
    const { agent } = await verifiedUser('osservatore');
    await agent
      .post('/api/v1/me/recently-viewed')
      .set('origin', WEB)
      .send({ listingIds: [ids[2], ids[1], ids[30]] })
      .expect(204);
    await agent
      .post('/api/v1/me/recently-viewed')
      .set('origin', WEB)
      .send({ listingIds: [ids[1]] })
      .expect(204);
    const list = (await agent.get('/api/v1/me/recently-viewed').expect(200)).body;
    expect(list.map((h: { id: string }) => h.id)).toEqual([ids[1], ids[2]]);
  });

  it('shows the new listings of followed users', async () => {
    const { agent } = await verifiedUser('fan');
    await agent.put(`/api/v1/users/${sellerId}/follow`).set('origin', WEB).expect(204);
    const page1 = (await agent.get('/api/v1/me/feed/following?limit=20').expect(200)).body;
    expect(page1.items).toHaveLength(20);
    const page2 = (
      await agent.get(`/api/v1/me/feed/following?limit=20&cursor=${page1.nextCursor}`).expect(200)
    ).body;
    expect(page2.items).toHaveLength(10);
    expect(page2.nextCursor).toBeNull();
    expect((await agent.get('/api/v1/me/following').expect(200)).body[0].username).toBe(
      'venditore',
    );
  });

  it('lists sitemap entries only for landing pages with at least 3 results', async () => {
    const server = env.app.getHttpServer();
    expect((await request(server).get('/api/v1/seo/sitemap').expect(200)).body).toEqual({
      listingPages: 1,
    });
    expect(
      (await request(server).get('/api/v1/seo/sitemap/listings').expect(200)).body,
    ).toHaveLength(30);
  });
});

describe('degraded mode', () => {
  it('falls back to PostgreSQL when Meilisearch is down', async () => {
    await env.meili?.stop();
    const res = await search({ q: 'Stratocaster', brand: ['fender'], priceMax: '200' });
    expect(res.degraded).toBe(true);
    expect(res.facets).toEqual({});
    expect(res.total).toBe(6); // Fender at i = 0, 2, …, 10 → 100 € … 200 €
    expect(res.hits.every((h) => h.title.includes('Stratocaster'))).toBe(true);
    const suggest = await request(env.app.getHttpServer())
      .get('/api/v1/search/suggest')
      .query({ q: 'gib' })
      .expect(200);
    expect(suggest.body[0]).toMatchObject({ kind: 'brand', label: 'Gibson' });
  });
});
