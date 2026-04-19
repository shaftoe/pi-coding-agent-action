/**
 * @file Tests for gitignore handling in file-scanner.ts
 *
 * Tests for nested .gitignore support, negation patterns, and
 * gitignored-file deletion safety logic.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...args as Parameters<typeof process.stdout.write>);
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing modules
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-scanner-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Mock octokit (not used by scanForChanges but needed for module loading)
mock.module('../../../../src/platform/github/octokit', () => ({
  getOctokit: mock(() => ({
    rest: {
      git: {
        getBlob: mock(() => Promise.resolve({ data: { content: '' } })),
        getTree: mock(() => Promise.resolve({ data: { tree: [] } })),
      },
    },
  })),
}));

// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 42 },
    serverUrl: 'https://github.com',
    runId: 123456789,
    payload: {},
  },
}));

// Import the module context reset function and git utilities
import { resetModuleContext } from '../../../../src/platform/github';
import { scanForChanges, scanDirectory } from '../../../../src/platform/github/git/file-scanner';
import { createLogger } from '../../../../src/platform/github/git/types';
import ignore from 'ignore';

// Set up mock CoreAdapter for all tests
const mockCoreAdapter = {
  getInput: mockGetInput,
  setFailed: mock(noop),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  warning: mock(noop),
};

describe('nested .gitignore support', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-scanner-test-'));
    process.env.GITHUB_WORKSPACE = tempDir;
    resetModuleContext(mockCoreAdapter);
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.GITHUB_WORKSPACE;
    resetModuleContext(undefined);
  });

  test('respects nested .gitignore in subdirectory', async () => {
    // Root .gitignore ignores *.log
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log');
    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root');

    // subdir/.gitignore negates: !important.log
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, '.gitignore'), '!important.log');
    fs.writeFileSync(path.join(subdir, 'error.log'), 'error');
    fs.writeFileSync(path.join(subdir, 'important.log'), 'important data');
    fs.writeFileSync(path.join(subdir, 'notes.txt'), 'notes');

    const referenceFiles = new Map<string, { sha: string; content: string | null }>();
    const result = await scanForChanges(referenceFiles);

    // important.log should be included (nested .gitignore negates root pattern)
    const paths = result.changedFiles.map(f => f.path);
    expect(paths).toContain(path.join('subdir', 'important.log'));

    // error.log should be ignored (root *.log still applies, no negation for it)
    expect(paths).not.toContain(path.join('subdir', 'error.log'));

    // Non-log files should be included
    expect(paths).toContain('root.txt');
    expect(paths).toContain(path.join('subdir', 'notes.txt'));
  });

  test('nested .gitignore with directory-scoped patterns only affects subdirectory', async () => {
    // Root .gitignore: ignore all .tmp files
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.tmp');
    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root');

    // subdir/.gitignore: negate *.tmp (only applies within subdir)
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, '.gitignore'), '!*.tmp');
    fs.writeFileSync(path.join(subdir, 'keep.tmp'), 'should be kept');

    // otherdir/ has no .gitignore - *.tmp should still be ignored
    const otherdir = path.join(tempDir, 'otherdir');
    fs.mkdirSync(otherdir, { recursive: true });
    fs.writeFileSync(path.join(otherdir, 'skip.tmp'), 'should be skipped');

    const referenceFiles = new Map<string, { sha: string; content: string | null }>();
    const result = await scanForChanges(referenceFiles);

    const paths = result.changedFiles.map(f => f.path);

    // subdir/keep.tmp should be included (negated by nested .gitignore)
    expect(paths).toContain(path.join('subdir', 'keep.tmp'));

    // otherdir/skip.tmp should NOT be included (root .gitignore still applies)
    expect(paths).not.toContain(path.join('otherdir', 'skip.tmp'));
  });

  test('handles deeply nested .gitignore files', async () => {
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.secret');

    // a/.gitignore: !*.secret
    const a = path.join(tempDir, 'a');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, '.gitignore'), '!*.secret');

    // a/b/.gitignore: *.secret (re-ignore)
    const ab = path.join(a, 'b');
    fs.mkdirSync(ab, { recursive: true });
    fs.writeFileSync(path.join(ab, '.gitignore'), '*.secret');

    // a/keep.secret - should be included (negated by a/.gitignore)
    fs.writeFileSync(path.join(a, 'keep.secret'), 'kept');

    // a/b/again.secret - should be ignored (re-ignored by a/b/.gitignore)
    fs.writeFileSync(path.join(ab, 'again.secret'), 'ignored again');

    // a/normal.txt - should be included
    fs.writeFileSync(path.join(a, 'normal.txt'), 'normal');

    const referenceFiles = new Map<string, { sha: string; content: string | null }>();
    const result = await scanForChanges(referenceFiles);

    const paths = result.changedFiles.map(f => f.path);
    expect(paths).toContain(path.join('a', 'keep.secret'));
    expect(paths).not.toContain(path.join('a', 'b', 'again.secret'));
    expect(paths).toContain(path.join('a', 'normal.txt'));
  });

  test('nested .gitignore with anchored patterns (leading /)', async () => {
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    // /config.json means only config.json directly in subdir/
    fs.writeFileSync(path.join(subdir, '.gitignore'), '/config.json');

    fs.writeFileSync(path.join(subdir, 'config.json'), '{}');
    fs.writeFileSync(path.join(subdir, 'other.json'), '[]');

    const nested = path.join(subdir, 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'config.json'), '{"nested":true}');

    const referenceFiles = new Map<string, { sha: string; content: string | null }>();
    const result = await scanForChanges(referenceFiles);

    const paths = result.changedFiles.map(f => f.path);

    // subdir/config.json should be ignored (anchored pattern)
    expect(paths).not.toContain(path.join('subdir', 'config.json'));

    // subdir/other.json should NOT be ignored
    expect(paths).toContain(path.join('subdir', 'other.json'));

    // subdir/nested/config.json should NOT be ignored (pattern is anchored to subdir/)
    expect(paths).toContain(path.join('subdir', 'nested', 'config.json'));
  });

  test('negation pattern in nested .gitignore prevents deletion of tracked files', async () => {
    // Simulate: root .gitignore ignores *.md
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.md');

    // docs/.gitignore negates: !README.md
    const docs = path.join(tempDir, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, '.gitignore'), '!README.md');
    fs.writeFileSync(path.join(docs, 'README.md'), 'readme content');

    // Reference tree has docs/README.md tracked
    const referenceFiles = new Map<string, { sha: string; content: string | null }>([
      [path.join('docs', 'README.md'), { sha: 'abc123', content: 'old readme' }],
    ]);

    const result = await scanForChanges(referenceFiles);

    // README.md should be detected as modified (it exists and content changed)
    expect(result.changedFiles.some(f => f.path === path.join('docs', 'README.md'))).toBe(true);

    // README.md should NOT be in deleted files
    expect(result.deletedFiles).not.toContain(path.join('docs', 'README.md'));
  });
});

describe('gitignored file deletion safety', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-scanner-del-test-'));
    process.env.GITHUB_WORKSPACE = tempDir;
    resetModuleContext(mockCoreAdapter);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.GITHUB_WORKSPACE;
    resetModuleContext(undefined);
  });

  test('does not delete gitignored files that still exist on disk', async () => {
    // Root .gitignore ignores *.log
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log');
    fs.writeFileSync(path.join(tempDir, 'app.log'), 'log data');
    fs.writeFileSync(path.join(tempDir, 'main.py'), 'print("hello")');

    // Reference tree has both app.log and main.py tracked
    const referenceFiles = new Map<string, { sha: string; content: string | null }>([
      ['app.log', { sha: 'abc', content: 'old log data' }],
      ['main.py', { sha: 'def', content: 'print("old")' }],
    ]);

    const result = await scanForChanges(referenceFiles);

    // app.log is gitignored so not in encounteredFiles, but it EXISTS on disk
    // → must NOT be marked as deleted
    expect(result.deletedFiles).not.toContain('app.log');

    // main.py should be detected as modified
    expect(result.changedFiles.some(f => f.path === 'main.py')).toBe(true);
  });

  test('correctly detects truly deleted files', async () => {
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log');
    fs.writeFileSync(path.join(tempDir, 'main.py'), 'print("hello")');

    // Reference tree has deleted.py which is NOT on disk
    const referenceFiles = new Map<string, { sha: string; content: string | null }>([
      ['main.py', { sha: 'abc', content: 'print("old")' }],
      ['deleted.py', { sha: 'def', content: 'gone forever' }],
    ]);

    const result = await scanForChanges(referenceFiles);

    // deleted.py is genuinely missing → should be marked as deleted
    expect(result.deletedFiles).toContain('deleted.py');

    // main.py should be modified
    expect(result.changedFiles.some(f => f.path === 'main.py')).toBe(true);
  });

  test('does not delete gitignored tracked file even without nested .gitignore', async () => {
    // Root .gitignore ignores everything in build/
    fs.writeFileSync(path.join(tempDir, '.gitignore'), 'build/');
    fs.writeFileSync(path.join(tempDir, 'main.py'), 'code');

    // build/ directory exists on disk with tracked files
    const buildDir = path.join(tempDir, 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'output.js'), 'compiled');

    const referenceFiles = new Map<string, { sha: string; content: string | null }>([
      ['main.py', { sha: 'abc', content: 'old code' }],
      [path.join('build', 'output.js'), { sha: 'def', content: 'old compiled' }],
    ]);

    const result = await scanForChanges(referenceFiles);

    // build/output.js is gitignored but exists → should NOT be deleted
    expect(result.deletedFiles).not.toContain(path.join('build', 'output.js'));

    // main.py should be modified
    expect(result.changedFiles.some(f => f.path === 'main.py')).toBe(true);
  });
});

describe('scanDirectory with nested .gitignore', () => {
  let tempDir: string;
  let mockLog: ReturnType<typeof createLogger>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-scanner-dir-test-'));
    resetModuleContext(mockCoreAdapter);
    mockLog = createLogger('🧪');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetModuleContext(undefined);
  });

  test('nested .gitignore patterns apply only within their directory', async () => {
    // subdir/.gitignore: *.tmp
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, '.gitignore'), '*.tmp');
    fs.writeFileSync(path.join(subdir, 'file.tmp'), 'tmp');
    fs.writeFileSync(path.join(subdir, 'file.txt'), 'txt');

    // otherdir/ has no .gitignore
    const otherdir = path.join(tempDir, 'otherdir');
    fs.mkdirSync(otherdir, { recursive: true });
    fs.writeFileSync(path.join(otherdir, 'file.tmp'), 'tmp');

    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    const paths = result.changedFiles.map(f => f.path);

    // subdir/file.tmp should be ignored (nested .gitignore)
    expect(paths).not.toContain(path.join('subdir', 'file.tmp'));

    // subdir/file.txt should be included
    expect(paths).toContain(path.join('subdir', 'file.txt'));

    // otherdir/file.tmp should be included (no .gitignore in otherdir)
    expect(paths).toContain(path.join('otherdir', 'file.tmp'));
  });

  test('negation pattern in nested .gitignore un-ignores files', async () => {
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, '.gitignore'), '*.tmp\n!important.tmp');
    fs.writeFileSync(path.join(subdir, 'regular.tmp'), 'regular');
    fs.writeFileSync(path.join(subdir, 'important.tmp'), 'important');

    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    const paths = result.changedFiles.map(f => f.path);
    expect(paths).not.toContain(path.join('subdir', 'regular.tmp'));
    expect(paths).toContain(path.join('subdir', 'important.tmp'));
  });
});
