/**
 * @file Tests for the platform-agnostic file scanner.
 *
 * Tests the shared scanning logic directly without any GitHub mocks,
 * demonstrating that the module is truly platform-independent.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import ignore from 'ignore';
import { scanForChanges, scanDirectory } from '../../src/git/file-scanner';
import type { Logger } from '../../src/git/types';

/**
 * A simple console-capturing logger for tests.
 */
function createTestLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  return {
    debug: (msg: string): void => {
      messages.push(msg);
    },
    info: (msg: string): void => {
      messages.push(msg);
    },
    messages,
  };
}

describe('shared file scanner (platform-agnostic)', () => {
  let tempDir: string;
  let log: ReturnType<typeof createTestLogger>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-scanner-test-'));
    log = createTestLogger();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scanForChanges', () => {
    test('detects new files using explicit repoRoot', async () => {
      fs.writeFileSync(path.join(tempDir, 'new-file.txt'), 'hello');

      const result = await scanForChanges(new Map(), log, { repoRoot: tempDir });

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]?.path).toBe('new-file.txt');
      expect(result.deletedFiles).toHaveLength(0);
    });

    test('uses process.cwd() as default repoRoot', async () => {
      // This test just verifies that scanForChanges works without a repoRoot option.
      // It won't find any changes relative to the actual cwd, but it shouldn't crash.
      const result = await scanForChanges(new Map(), log);
      expect(result).toBeDefined();
      expect(result.changedFiles).toBeDefined();
      expect(result.deletedFiles).toBeDefined();
    });

    test('detects modified files', async () => {
      const referenceFiles = new Map([['test.txt', { sha: 'abc123', content: 'old content' }]]);
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'new content');

      const result = await scanForChanges(referenceFiles, log, { repoRoot: tempDir });

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]?.content).toBe('new content');
    });

    test('detects deleted files', async () => {
      const referenceFiles = new Map([
        ['deleted.txt', { sha: 'abc', content: 'gone' }],
        ['kept.txt', { sha: 'def', content: 'still here' }],
      ]);
      fs.writeFileSync(path.join(tempDir, 'kept.txt'), 'still here');

      const result = await scanForChanges(referenceFiles, log, { repoRoot: tempDir });

      expect(result.changedFiles).toHaveLength(0);
      expect(result.deletedFiles).toContain('deleted.txt');
      expect(result.deletedFiles).not.toContain('kept.txt');
    });

    test('respects .gitignore', async () => {
      fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log');
      fs.writeFileSync(path.join(tempDir, 'important.txt'), 'keep this');
      fs.writeFileSync(path.join(tempDir, 'debug.log'), 'ignore this');

      const result = await scanForChanges(new Map(), log, { repoRoot: tempDir });

      const paths = result.changedFiles.map(f => f.path);
      expect(paths).toContain('important.txt');
      expect(paths).not.toContain('debug.log');
    });

    test('applies extra ignorePatterns option', async () => {
      fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'keep');
      fs.writeFileSync(path.join(tempDir, 'exclude.txt'), 'exclude');

      const result = await scanForChanges(new Map(), log, {
        repoRoot: tempDir,
        ignorePatterns: ['exclude.txt'],
      });

      const paths = result.changedFiles.map(f => f.path);
      expect(paths).toContain('keep.txt');
      expect(paths).not.toContain('exclude.txt');
    });

    test('does not delete gitignored files that still exist on disk', async () => {
      fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log');
      fs.writeFileSync(path.join(tempDir, 'app.log'), 'log data');
      fs.writeFileSync(path.join(tempDir, 'main.py'), 'print("hello")');

      const referenceFiles = new Map([
        ['app.log', { sha: 'abc', content: 'old log' }],
        ['main.py', { sha: 'def', content: 'print("old")' }],
      ]);

      const result = await scanForChanges(referenceFiles, log, { repoRoot: tempDir });

      expect(result.deletedFiles).not.toContain('app.log');
      expect(result.changedFiles.some(f => f.path === 'main.py')).toBe(true);
    });

    test('handles nested directories', async () => {
      const subdir = path.join(tempDir, 'src', 'utils');
      fs.mkdirSync(subdir, { recursive: true });
      fs.writeFileSync(path.join(subdir, 'helper.ts'), 'export {};');

      const result = await scanForChanges(new Map(), log, { repoRoot: tempDir });

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]?.path).toBe(path.join('src', 'utils', 'helper.ts'));
    });
  });

  describe('scanDirectory', () => {
    test('scans single file', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');

      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles: new Map(),
        ig: ignore(),
        log,
      });

      expect(result.changedFiles).toHaveLength(1);
      expect(result.encounteredFiles.has('test.txt')).toBe(true);
    });

    test('respects ignore patterns', async () => {
      fs.writeFileSync(path.join(tempDir, 'included.txt'), 'included');
      fs.writeFileSync(path.join(tempDir, 'excluded.txt'), 'excluded');

      const ig = ignore();
      ig.add('excluded.txt');

      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles: new Map(),
        ig,
        log,
      });

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]?.path).toBe('included.txt');
    });

    test('handles nested gitignore in subdirectory', async () => {
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir, { recursive: true });
      fs.writeFileSync(path.join(subdir, '.gitignore'), '*.tmp');
      fs.writeFileSync(path.join(subdir, 'file.tmp'), 'tmp');
      fs.writeFileSync(path.join(subdir, 'file.txt'), 'txt');

      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles: new Map(),
        ig: ignore(),
        log,
      });

      const paths = result.changedFiles.map(f => f.path);
      expect(paths).not.toContain(path.join('subdir', 'file.tmp'));
      expect(paths).toContain(path.join('subdir', 'file.txt'));
    });

    test('handles empty directory', async () => {
      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles: new Map(),
        ig: ignore(),
        log,
      });

      expect(result.changedFiles).toHaveLength(0);
      expect(result.encounteredFiles.size).toBe(0);
    });

    test('compares files with reference', async () => {
      fs.writeFileSync(path.join(tempDir, 'unchanged.txt'), 'same');
      fs.writeFileSync(path.join(tempDir, 'changed.txt'), 'different');
      fs.writeFileSync(path.join(tempDir, 'new.txt'), 'new');

      const referenceFiles = new Map([
        ['unchanged.txt', { sha: 'abc123', content: 'same' }],
        ['changed.txt', { sha: 'def456', content: 'old' }],
      ]);

      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles,
        ig: ignore(),
        log,
      });

      expect(result.changedFiles).toHaveLength(2);
      expect(result.changedFiles.some(f => f.path === 'changed.txt')).toBe(true);
      expect(result.changedFiles.some(f => f.path === 'new.txt')).toBe(true);
      expect(result.changedFiles.some(f => f.path === 'unchanged.txt')).toBe(false);
    });
  });

  describe('binary and unreadable files', () => {
    test('skips binary files that cannot be read as utf-8', async () => {
      // Create a file with invalid UTF-8 sequences that will cause readFileSync to fail
      // We use a file with no read permissions to simulate a read error
      const binaryPath = path.join(tempDir, 'binary.bin');
      fs.writeFileSync(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
      fs.chmodSync(binaryPath, 0o000);

      try {
        const result = await scanDirectory({
          dir: tempDir,
          relativePath: '',
          referenceFiles: new Map(),
          ig: ignore(),
          log,
        });

        // Binary/unreadable file should be skipped, not included in changed files
        expect(result.changedFiles.every(f => f.path !== 'binary.bin')).toBe(true);
        // The file was encountered but skipped
        expect(
          log.messages.some(m => m.includes('skipping file (likely binary): binary.bin'))
        ).toBe(true);
      } finally {
        // Restore permissions so cleanup can delete the file
        fs.chmodSync(binaryPath, 0o644);
      }
    });

    test('skips binary files via scanForChanges', async () => {
      const binaryPath = path.join(tempDir, 'unreadable.dat');
      fs.writeFileSync(binaryPath, Buffer.from([0xff, 0xfe, 0x00, 0x01]));
      fs.chmodSync(binaryPath, 0o000);

      try {
        const result = await scanForChanges(new Map(), log, { repoRoot: tempDir });

        expect(result.changedFiles.every(f => f.path !== 'unreadable.dat')).toBe(true);
        expect(log.messages.some(m => m.includes('skipping file'))).toBe(true);
      } finally {
        fs.chmodSync(binaryPath, 0o644);
      }
    });
  });

  describe('platform independence', () => {
    test('scanForChanges works without any GitHub dependencies', async () => {
      // This test proves the scanner is platform-agnostic:
      // - No @actions/core mock needed
      // - No @actions/github mock needed
      // - No Octokit mock needed
      // - Only needs a Logger interface implementation
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Hello');
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export {};');

      const result = await scanForChanges(new Map(), log, { repoRoot: tempDir });

      expect(result.changedFiles.length).toBeGreaterThanOrEqual(2);
      expect(result.changedFiles.some(f => f.path === 'README.md')).toBe(true);
      expect(result.changedFiles.some(f => f.path === path.join('src', 'index.ts'))).toBe(true);
    });

    test('scanDirectory works without any GitHub dependencies', async () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');

      const result = await scanDirectory({
        dir: tempDir,
        relativePath: '',
        referenceFiles: new Map(),
        ig: ignore(),
        log,
      });

      expect(result.changedFiles).toHaveLength(1);
    });
  });
});
