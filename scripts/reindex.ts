/**
 * `pnpm search:reindex`: rebuilds every Meilisearch index from PostgreSQL into a fresh index and
 * swaps it with the live one atomically (SPEC §9.3), so search never goes down.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '@accordo/db';
import { createSearchClient, reindex } from '@accordo/search';

const rootEnv = resolve(import.meta.dirname, '../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const { DATABASE_URL, MEILI_HOST, MEILI_MASTER_KEY } = process.env;
if (!DATABASE_URL || !MEILI_HOST || !MEILI_MASTER_KEY)
  throw new Error('DATABASE_URL, MEILI_HOST and MEILI_MASTER_KEY are required');

const db = createPrismaClient(DATABASE_URL);
const started = Date.now();
try {
  const { listings } = await reindex(
    createSearchClient(MEILI_HOST, MEILI_MASTER_KEY, 60_000),
    db,
    console.log,
  );
  console.log(
    `Reindicizzati ${listings} annunci in ${Math.round((Date.now() - started) / 1000)} s`,
  );
} finally {
  await db.$disconnect();
}
