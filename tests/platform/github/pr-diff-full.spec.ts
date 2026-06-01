/**
 * @file Tests for fetchPRDiff and filterDiffByIgnoreFiles (full integration with deps).
 *
 * Covers the fetchPRDiff function that retrieves PR diffs via the GitHub API
 * and filters them using ignore patterns.
 */

import { describe, expect, test, mock } from 'bun:test';
import { fetchPRDiff, filterDiffByIgnoreFiles, matchesIgnorePattern } from '../../../src/platform/github/tools/pr-diff';
import type { GitHubModuleDeps } from '../../../src/platform/github/types';

const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
 
 export const main = foo;
diff --git a/package-lock.json b/package-lock.json
index aaa1111..bbb2222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,2 @@
 {
+  "locked": true
+}
`;

function createDeps(): GitHubModuleDeps & {
  octokit: {
    rest: {
      pulls: {
        get: ReturnType<typeof mock>;
      };
    };
  };
} {
  return {
    octokit: {
      rest: {
        pulls: {
          get: mock(() =>
            Promise.resolve({
              data: SAMPLE_DIFF,
              status: 200,
            })
          ),
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'pull_request',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warning: mock(() => {}),
      notice: mock(() => {}),
      error: mock(() => {}),
    },
  };
}

describe('fetchPRDiff', () => {
  test('returns the diff string from the API', async () => {
    const deps = createDeps();
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42);
    expect(result).toContain('diff --git a/src/index.ts');
    expect(result).toContain('import { bar }');
  });

  test('calls the API with correct parameters', async () => {
    const deps = createDeps();
    await fetchPRDiff(deps, 'my-org', 'my-repo', 99);

    const callArgs = (deps.octokit.rest.pulls.get as any).mock.calls[0][0];
    expect(callArgs).toMatchObject({
      owner: 'my-org',
      repo: 'my-repo',
      pull_number: 99,
    });
    expect(callArgs.mediaType).toEqual({ format: 'diff' });
  });

  test('returns empty string when diff is falsy', async () => {
    const deps = createDeps();
    (deps.octokit.rest.pulls.get as any).mockImplementation(() =>
      Promise.resolve({ data: null, status: 200 })
    );
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42);
    expect(result).toBe('');
  });

  test('returns empty string when diff is empty', async () => {
    const deps = createDeps();
    (deps.octokit.rest.pulls.get as any).mockImplementation(() =>
      Promise.resolve({ data: '', status: 200 })
    );
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42);
    expect(result).toBe('');
  });

  test('filters diff by ignore patterns', async () => {
    const deps = createDeps();
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42, ['package-lock.json']);
    expect(result).not.toContain('package-lock.json');
    expect(result).toContain('src/index.ts');
  });

  test('does not filter when ignoreFiles is empty', async () => {
    const deps = createDeps();
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42, []);
    expect(result).toContain('package-lock.json');
    expect(result).toContain('src/index.ts');
  });

  test('does not filter when ignoreFiles is undefined', async () => {
    const deps = createDeps();
    const result = await fetchPRDiff(deps, 'test-owner', 'test-repo', 42);
    expect(result).toBe(SAMPLE_DIFF);
  });
});

describe('matchesIgnorePattern additional coverage', () => {
  test('matches exact path with b/ prefix', () => {
    expect(matchesIgnorePattern('b/src/file.ts', ['src/file.ts'])).toBe(true);
  });

  test('matches directory prefix without trailing slash (file in dir)', () => {
    expect(matchesIgnorePattern('a/src/utils/helpers.ts', ['src/utils'])).toBe(true);
  });

  test('does not match partial filename', () => {
    expect(matchesIgnorePattern('a/src/index.ts', ['index'])).toBe(false);
  });
});

describe('filterDiffByIgnoreFiles additional coverage', () => {
  const noopDeps: GitHubModuleDeps = {
    octokit: {} as any,
    context: {
      repo: { owner: 'o', repo: 'r' },
      issue: { number: 1 },
      eventName: 'issue_comment',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 1,
      workspace: '/tmp',
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warning: mock(() => {}),
      notice: mock(() => {}),
      error: mock(() => {}),
    },
  };

  test('returns original diff when ignoreFiles is empty array', () => {
    const diff = 'some content';
    const result = filterDiffByIgnoreFiles(noopDeps, diff, []);
    expect(result).toBe(diff);
  });

  test('handles diff with malformed header gracefully', () => {
    const malformedDiff = `diff --git a/path with spaces b/path with spaces
--- a/path with spaces
+++ b/path with spaces
@@ -1 +1 @@
-old
+new`;
    const result = filterDiffByIgnoreFiles(noopDeps, malformedDiff, ['other/']);
    // Should keep the diff since the file doesn't match 'other/'
    expect(result).toContain('old');
    expect(result).toContain('new');
  });

  test('logs when diff is filtered', () => {
    const debugMock = mock(() => {});
    const deps: GitHubModuleDeps = {
      ...noopDeps,
      logger: { ...noopDeps.logger, debug: debugMock },
    };
    filterDiffByIgnoreFiles(deps, SAMPLE_DIFF, ['package-lock.json']);
    expect(debugMock).toHaveBeenCalled();
  });

  test('does not log when diff is unchanged', () => {
    const debugMock = mock(() => {});
    const deps: GitHubModuleDeps = {
      ...noopDeps,
      logger: { ...noopDeps.logger, debug: debugMock },
    };
    filterDiffByIgnoreFiles(deps, SAMPLE_DIFF, ['nonexistent/']);
    // Debug should have been called for non-filtering scenarios too, but the filter-specific log should not appear
    const calls = debugMock.mock.calls.map((c: any[]) => c[0]);
    const filterLog = calls.find((c: string) => c?.includes?.('[filterDiffByIgnoreFiles]'));
    expect(filterLog).toBeUndefined();
  });
});
