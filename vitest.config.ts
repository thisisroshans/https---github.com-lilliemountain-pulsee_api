import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/helpers/setup-env.ts'],
    // Integration tests share one database; keep files serial to avoid
    // cross-test interference until per-test transactions are in place.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/scripts/**', 'src/types/**', 'src/**/*.schema.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
