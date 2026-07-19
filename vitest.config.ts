import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration — replaces `bun test`.
 *
 * Unit tests live in each package's `tests/` directory (`*.spec.ts`).
 * E2E tests (`tests/e2e/`) are collected but gated behind the
 * `RUN_E2E_TESTS=1` env var via `isE2EEnabled()`; they report as skipped
 * otherwise.
 */
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['dist/**', '**/*.spec.ts', '**/tests/**'],
    },
  },
});
