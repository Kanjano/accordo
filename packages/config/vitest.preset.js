import { defineConfig } from 'vitest/config';

/** Shared Vitest defaults for workspace packages. */
export const vitestPreset = defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.spec.ts'] },
  },
});
