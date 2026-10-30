import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed/index.ts' },
  // Migrations run with a dedicated (privileged) user; the app uses DATABASE_URL at runtime.
  datasource: { url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? '' },
});
