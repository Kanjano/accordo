import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '../../src/index.js';
import { seedCatalog, seedGeo, seedHolidays, seedPlatformSettings } from './base.js';
import { seedDemo, seedDemoCredentials } from './demo.js';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Demo data only outside production: always with --demo, by default in development.
const withDemo =
  process.argv.includes('--demo') || (process.env.NODE_ENV ?? 'development') === 'development';
if (withDemo && process.env.NODE_ENV === 'production')
  throw new Error('Demo data is never seeded in production');

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createPrismaClient(url);

try {
  console.log('Seed di base');
  await seedGeo(db);
  await seedCatalog(db);
  await seedHolidays(db);
  await seedPlatformSettings(db);
  if (withDemo) {
    console.log('Dati demo');
    await seedDemo(db);
    await seedDemoCredentials(db);
  }
} finally {
  await db.$disconnect();
}
