import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.int.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
});
