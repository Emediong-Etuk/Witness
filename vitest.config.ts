import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/gate/src/**', 'packages/features/src/**'],
      thresholds: { lines: 90 },
    },
  },
});
