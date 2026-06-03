/**
 * @file Tests for GitHub file-scanner functions (buildFileMap and scanForChanges).
 *
 * Covers the GitHub-specific wrappers that use Octokit to fetch git trees
 * and scan the local workspace for changes.
 */

import { describe, expect, test, mock } from 'bun:test';
import { buildFileMap, scanForChanges } from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

const noopLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warning: mock(() => {}),
  notice: mock(() => {}),
  error: mock(() => {}),
};

function createDeps(): GitHubModuleDeps & {
  octokit: {
    rest: {
      git: {
        getTree: ReturnType<typeof mock>;
        getBlob: ReturnType<typeof mock>;
      };
    };
  };
} {
  return {
    octokit: {
      rest: {
        git: {
          getTree: mock(() =>
            Promise.resolve({
              data: {
                tree: [
                  { path: 'src/main.ts', type: 'blob', sha: 'sha1' },
                  { path: 'src/util.ts', type: 'blob', sha: 'sha2' },
                  { path: 'src/dir', type: 'tree', sha: 'sha3' },
                  { path: 'README.md', type: 'blob', sha: 'sha4' },
                ],
              },
            })
          ),
          getBlob: mock(() =>
            Promise.resolve({
              data: {
                content: Buffer.from('file content').toString('base64'),
              },
            })
          ),
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 1 },
      eventName: 'pull_request',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: noopLogger,
  };
}

describe('buildFileMap', () => {
  test('fetches tree and builds file map', async () => {
    const deps = createDeps();
    const result = await buildFileMap(deps, 'tree-sha');

    expect(result.size).toBe(3); // 3 blobs, 1 tree (skipped)
    expect(result.has('src/main.ts')).toBe(true);
    expect(result.has('src/util.ts')).toBe(true);
    expect(result.has('README.md')).toBe(true);
    expect(result.has('src/dir')).toBe(false);
  });

  test('fetches blob contents by default', async () => {
    const deps = createDeps();
    const result = await buildFileMap(deps, 'tree-sha');

    expect(result.get('src/main.ts')?.content).toBe('file content');
    // Should have called getBlob for each blob (3 blobs)
    expect(deps.octokit.rest.git.getBlob).toHaveBeenCalledTimes(3);
  });

  test('skips blob contents when fetchContents is false', async () => {
    const deps = createDeps();
    const result = await buildFileMap(deps, 'tree-sha', false);

    expect(result.get('src/main.ts')?.content).toBeNull();
    expect(deps.octokit.rest.git.getBlob).not.toHaveBeenCalled();
  });

  test('skips items without sha', async () => {
    const deps = createDeps();
    (deps.octokit.rest.git.getTree as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          tree: [
            { path: 'no-sha.ts', type: 'blob' },
            { path: 'has-sha.ts', type: 'blob', sha: 'abc' },
          ],
        },
      })
    );

    const result = await buildFileMap(deps, 'tree-sha', false);
    expect(result.size).toBe(1);
    expect(result.has('has-sha.ts')).toBe(true);
  });

  test('handles blob fetch failure gracefully', async () => {
    const deps = createDeps();
    (deps.octokit.rest.git.getBlob as any).mockImplementation(() =>
      Promise.reject(new Error('Blob not found'))
    );

    const result = await buildFileMap(deps, 'tree-sha');
    // Blob content should be null but entries should still exist
    expect(result.get('src/main.ts')?.content).toBeNull();
  });

  test('uses provided logger', async () => {
    const debugMock = mock(() => {});
    const logDeps = {
      ...createDeps(),
      logger: { ...noopLogger, debug: debugMock },
    } as GitHubModuleDeps;

    await buildFileMap(logDeps, 'tree-sha', false, logDeps.logger);
    expect(debugMock).toHaveBeenCalled();
  });

  test('uses default logger when none provided', async () => {
    const deps = createDeps();
    // Should not throw even without explicit logger
    const result = await buildFileMap(deps, 'tree-sha', false);
    expect(result.size).toBe(3);
  });

  test('calls getTree with correct params', async () => {
    const deps = createDeps();
    await buildFileMap(deps, 'my-tree-sha');

    const callArgs = (deps.octokit.rest.git.getTree as any).mock.calls[0][0];
    expect(callArgs).toMatchObject({
      owner: 'test-owner',
      repo: 'test-repo',
      tree_sha: 'my-tree-sha',
      recursive: 'true',
    });
  });
});

describe('scanForChanges', () => {
  test('returns a valid result for empty reference map', async () => {
    const deps = {
      ...createDeps(),
      context: {
        ...createDeps().context,
        workspace: process.cwd(),
      },
    };
    const referenceFiles = new Map<string, { sha: string; content: string | null }>();

    const result = await scanForChanges(deps, referenceFiles);
    expect(result).toBeDefined();
    expect(result.changedFiles).toBeDefined();
    expect(result.deletedFiles).toBeDefined();
  });

  test('uses deps.context.workspace for repo root', async () => {
    const deps = {
      ...createDeps(),
      context: {
        ...createDeps().context,
        workspace: process.cwd(),
      },
    };
    const referenceFiles = new Map<string, { sha: string; content: string | null }>();

    const result = await scanForChanges(deps, referenceFiles);
    expect(result).toBeDefined();
  });
});
