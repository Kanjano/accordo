import type { PrismaClient } from '@accordo/db';
import { type EnqueuedTaskPromise, Meilisearch, type Settings } from 'meilisearch';
import {
  documentInclude,
  INDEXED_STATUSES,
  type ListingDocument,
  toListingDocument,
} from './document.js';
import {
  brandsSettings,
  categoriesSettings,
  DEFAULT_SYNONYMS,
  INDEX,
  listingsSettings,
} from './settings.js';

export function createSearchClient(host: string, apiKey: string, timeoutMs = 2000): Meilisearch {
  return new Meilisearch({ host, apiKey, timeout: timeoutMs });
}

/** Waits for a task and turns a failed task into an exception. */
async function done(task: EnqueuedTaskPromise, timeout = 60_000) {
  const t = await task.waitTask({ timeout });
  if (t.status === 'failed') throw new Error(`Meilisearch ${t.type} failed: ${t.error?.message}`);
  return t;
}

async function synonyms(db: PrismaClient): Promise<string[][]> {
  const row = await db.platformSetting.findUnique({ where: { key: 'searchSynonyms' } });
  return Array.isArray(row?.value) ? (row.value as string[][]) : DEFAULT_SYNONYMS;
}

async function settingsFor(db: PrismaClient): Promise<Record<string, Settings>> {
  return {
    [INDEX.listings]: listingsSettings(await synonyms(db)),
    [INDEX.brands]: brandsSettings,
    [INDEX.categories]: categoriesSettings,
  };
}

async function exists(client: Meilisearch, uid: string) {
  return client
    .getIndex(uid)
    .then(() => true)
    .catch(() => false);
}

/** Creates missing indexes and (re)applies their settings; a no-op when nothing changed. */
export async function ensureIndexes(client: Meilisearch, db: PrismaClient): Promise<void> {
  for (const [uid, settings] of Object.entries(await settingsFor(db))) {
    if (!(await exists(client, uid))) await done(client.createIndex(uid, { primaryKey: 'id' }));
    await done(client.index(uid).updateSettings(settings), 600_000);
  }
}

/** Upserts the listings that are indexable and removes the others (idempotent, SPEC §9.3). */
export async function syncListings(client: Meilisearch, db: PrismaClient, ids: string[]) {
  const rows = await db.listing.findMany({
    where: { id: { in: ids }, status: { in: [...INDEXED_STATUSES] }, deletedAt: null },
    include: documentInclude,
  });
  const kept = new Set(rows.map((r) => r.id));
  const removed = ids.filter((id) => !kept.has(id));
  const index = client.index<ListingDocument>(INDEX.listings);
  if (rows.length) await done(index.addDocuments(rows.map(toListingDocument)));
  if (removed.length) await done(index.deleteDocuments(removed));
  return { upserted: rows.length, removed: removed.length };
}

async function catalogDocuments(db: PrismaClient) {
  const [brands, categories, counts] = await Promise.all([
    db.brand.findMany({ select: { id: true, name: true, slug: true, aliases: true } }),
    db.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        department: { select: { slug: true, name: true } },
      },
    }),
    db.listing.groupBy({
      by: ['brandId'],
      where: { status: { in: [...INDEXED_STATUSES] }, brandId: { not: null } },
      _count: true,
    }),
  ]);
  const byBrand = new Map(counts.map((c) => [c.brandId, c._count]));
  return {
    [INDEX.brands]: brands.map((b) => ({ ...b, listingsCount: byBrand.get(b.id) ?? 0 })),
    [INDEX.categories]: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      departmentSlug: c.department.slug,
      departmentName: c.department.name,
    })),
  };
}

/** Small indexes for autocomplete; replaced wholesale. */
export async function syncCatalog(client: Meilisearch, db: PrismaClient): Promise<void> {
  for (const [uid, docs] of Object.entries(await catalogDocuments(db))) {
    await done(client.index(uid).addDocuments(docs, { primaryKey: 'id' }));
  }
}

/**
 * Full rebuild without downtime (SPEC §9.3): each index is built as `<uid>_next`, then swapped
 * atomically with the live one; the old copy is dropped.
 */
export async function reindex(
  client: Meilisearch,
  db: PrismaClient,
  log: (msg: string) => void = () => undefined,
): Promise<{ listings: number }> {
  const settings = await settingsFor(db);
  const catalog = await catalogDocuments(db);
  let listings = 0;
  for (const uid of Object.values(INDEX)) {
    const next = `${uid}_next`;
    await client.deleteIndexIfExists(next);
    await done(client.createIndex(next, { primaryKey: 'id' }));
    await done(client.index(next).updateSettings(settings[uid] as Settings), 600_000);
    if (uid === INDEX.listings) {
      let cursor = '';
      for (;;) {
        const rows = await db.listing.findMany({
          where: { status: { in: [...INDEXED_STATUSES] }, deletedAt: null, id: { gt: cursor } },
          include: documentInclude,
          orderBy: { id: 'asc' },
          take: 5000,
        });
        if (!rows.length) break;
        await done(client.index(next).addDocuments(rows.map(toListingDocument)), 600_000);
        listings += rows.length;
        cursor = rows.at(-1)?.id as string;
        log(`  ${listings} annunci`);
      }
    } else {
      await done(client.index(next).addDocuments(catalog[uid] as object[]));
    }
    const live = await exists(client, uid);
    // First run: there is nothing to swap with, so `next` is renamed to the live name.
    await done(
      client.swapIndexes([
        live ? { indexes: [uid, next], rename: false } : { indexes: [next, uid], rename: true },
      ]),
    );
    if (live) await done(client.deleteIndex(next));
    log(`${uid}: indice scambiato`);
  }
  return { listings };
}
