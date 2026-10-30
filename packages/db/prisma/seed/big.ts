// `pnpm db:seed:big`: 100 000 listings for search benchmarks (development only, needs the base seed).
// Re-running replaces the previous big data set. Then run `pnpm search:reindex`.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateShortId, slugify } from '@accordo/domain';
import { fakerIT as faker } from '@faker-js/faker';
import type { ItemCondition, Prisma } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/index.js';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (process.env.NODE_ENV === 'production') throw new Error('Never seed big data in production');

const TOTAL = Number(process.env.BIG_LISTINGS ?? 100_000);
const SELLERS = 2000;
const BATCH = 5000;
const DOMAIN = '@big.accordo.local';
const DAY = 86_400_000;
const MODELS = ['Standard', 'Deluxe', 'Custom', 'Pro', 'Classic', 'Vintage', 'Studio', 'Player'];
const CONDITIONS: ItemCondition[] = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'FOR_PARTS'];

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createPrismaClient(url);
faker.seed(4242);

try {
  const started = Date.now();
  const old = await db.listing.deleteMany({ where: { seller: { email: { endsWith: DOMAIN } } } });
  await db.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  if (old.count) console.log(`  rimossi ${old.count} annunci del giro precedente`);

  const [categories, brands, comuni] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
    db.comune.findMany({
      where: { lat: { not: null } },
      select: { id: true, lat: true, lng: true },
    }),
  ]);
  if (!categories.length || !comuni.length) throw new Error('Run pnpm db:seed first');

  await db.user.createMany({
    data: Array.from({ length: SELLERS }, (_, i) => ({
      name: faker.person.fullName(),
      email: `big-${i}${DOMAIN}`,
      username: `big_${i}`,
      emailVerified: true,
    })),
  });
  const sellers = await db.user.findMany({
    where: { email: { endsWith: DOMAIN } },
    select: { id: true },
  });

  const shortIds = new Set<string>();
  for (let done = 0; done < TOTAL; done += BATCH) {
    const rows: Prisma.ListingCreateManyInput[] = [];
    for (let i = 0; i < Math.min(BATCH, TOTAL - done); i++) {
      let shortId = generateShortId();
      while (shortIds.has(shortId)) shortId = generateShortId();
      shortIds.add(shortId);
      const category = faker.helpers.arrayElement(categories);
      const brand = faker.helpers.arrayElement(brands);
      const comune = faker.helpers.arrayElement(comuni);
      const title = `${brand.name} ${faker.helpers.arrayElement(MODELS)} ${faker.number.int({ min: 10, max: 999 })} ${category.name.toLowerCase()}`;
      const publishedAt = new Date(Date.now() - faker.number.int({ min: 0, max: 59 * DAY }));
      rows.push({
        shortId,
        slug: slugify(title),
        sellerId: faker.helpers.arrayElement(sellers).id,
        categoryId: category.id,
        brandId: brand.id,
        status: faker.number.float() < 0.95 ? 'ACTIVE' : 'SOLD',
        title,
        description: faker.lorem.sentences(3),
        condition: faker.helpers.arrayElement(CONDITIONS),
        year: faker.number.int({ min: 1965, max: 2026 }),
        // Log-uniform between 20 € and 8 000 €.
        priceCents: Math.round(2000 * 400 ** faker.number.float()),
        isNegotiable: faker.datatype.boolean(),
        shippingIntegrated: faker.datatype.boolean(),
        handDeliveryEnabled: true,
        comuneId: comune.id,
        lat: comune.lat,
        lng: comune.lng,
        publishedAt,
        bumpedAt: publishedAt,
        expiresAt: new Date(publishedAt.getTime() + 60 * DAY),
      });
    }
    await db.listing.createMany({ data: rows });
    console.log(`  ${done + rows.length} / ${TOTAL} annunci`);
  }
  console.log(`Fatto in ${Math.round((Date.now() - started) / 1000)} s. Ora: pnpm search:reindex`);
} finally {
  await db.$disconnect();
}
