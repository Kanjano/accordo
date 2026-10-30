import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, include: ['test/**/*.int.ts'], testTimeout: 60_000, hookTimeout: 240_000 },
});
