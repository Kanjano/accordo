import { vitestPreset } from '@accordo/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// SPEC §15.1: packages/domain coverage ≥ 95%.
export default mergeConfig(
  vitestPreset,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        exclude: ['src/index.ts', 'src/**/*.spec.ts'],
        thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
      },
    },
  }),
);
