import { defineConfig, devices } from '@playwright/test';

// Test-only switches: auth rate limits off (each run registers new users) and a dummy analytics
// script so the consent test can observe when it is (not) loaded.
process.env.RATE_LIMIT_ENABLED ??= 'false';
process.env.NEXT_PUBLIC_ANALYTICS_SRC ??= 'http://localhost:3000/analytics-test.js';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Requires `pnpm infra:up` (PostgreSQL, Valkey, Meilisearch, RustFS, Mailpit) and a migrated database.
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
  },
});
