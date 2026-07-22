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
    // Tests that exercise the real Pi agent (`agent-logic.spec.ts`) call
    // `Agent.ready()`, which dynamically imports and initialises the full Pi
    // SDK extension surface. On CI's slower, cold-start container runtime
    // this comfortably exceeds Vitest's default 5000ms ceiling (observed at
    // ~5000ms on GitHub Actions runners). 15000ms gives ample headroom
    // without masking genuine hangs.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['dist/**', '**/*.spec.ts', '**/tests/**'],
    },
  },
});
