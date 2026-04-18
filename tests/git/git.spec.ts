import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import ignore from 'ignore';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockDebugLog: string[] = [];
const debugLogger = (msg: string): void => {
  mockDebugLog.push(msg);
};

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
  debug: mock(debugLogger),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing git-utils.ts
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Dynamic import to ensure mocks are set before module loads
const gitUtilsModule = import('../../src/git/git/index.js');

// Extract functions for convenience (using top-level await pattern)
const [{ createLogger, scanDirectory, scanForChanges }] = // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await Promise.all([gitUtilsModule]);

describe('createLogger', () => {
  test('creates logger with default emoji', () => {
    const logger = createLogger();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
  });

  test('creates logger with custom emoji', () => {
    const logger = createLogger('🧪');
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
  });
});

describe('scanForChanges', () => {
  let tempDir: string;
  let mockLog: ReturnType<typeof createLogger>;

  beforeEach(() => {
    mockDebugLog.length = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-utils-test-'));
    mockLog = createLogger('🧪');
    process.env.GITHUB_WORKSPACE = tempDir;
  });

  test('detects new files', async () => {
    // Create a new file in temp directory
    const testFile = path.join(tempDir, 'new-file.txt');
    fs.writeFileSync(testFile, 'new content');

    const referenceFiles = new Map();

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe('new-file.txt');
    expect(result.changedFiles[0]!.content).toBe('new content');
    expect(result.deletedFiles).toHaveLength(0);
  });

  test('detects modified files', async () => {
    // Create reference and modify it
    const referenceFiles = new Map([['test.txt', { sha: 'abc123', content: 'old content' }]]);

    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'new content');

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe('test.txt');
    expect(result.changedFiles[0]!.content).toBe('new content');
    expect(result.deletedFiles).toHaveLength(0);
  });

  test('ignores unchanged files', async () => {
    const referenceFiles = new Map([['unchanged.txt', { sha: 'abc123', content: 'same content' }]]);

    const testFile = path.join(tempDir, 'unchanged.txt');
    fs.writeFileSync(testFile, 'same content');

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(0);
    expect(result.deletedFiles).toHaveLength(0);
  });

  test('detects deleted files', async () => {
    const referenceFiles = new Map([
      ['deleted.txt', { sha: 'abc123', content: 'content' }],
      ['remaining.txt', { sha: 'def456', content: 'still here' }],
    ]);

    // Only create remaining file
    const remainingFile = path.join(tempDir, 'remaining.txt');
    fs.writeFileSync(remainingFile, 'still here');

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(0);
    expect(result.deletedFiles).toHaveLength(1);
    expect(result.deletedFiles).toContain('deleted.txt');
  });

  test('handles nested directories', async () => {
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });

    const nestedFile = path.join(subdir, 'nested.txt');
    fs.writeFileSync(nestedFile, 'nested content');

    const referenceFiles = new Map();

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe(path.join('subdir', 'nested.txt'));
  });

  test('respects .gitignore', async () => {
    const gitignore = path.join(tempDir, '.gitignore');
    fs.writeFileSync(gitignore, 'ignored.txt\n*.log');

    // Create ignored files
    fs.writeFileSync(path.join(tempDir, 'ignored.txt'), 'should be ignored');
    fs.writeFileSync(path.join(tempDir, 'test.log'), 'should also be ignored');

    // Create non-ignored file
    fs.writeFileSync(path.join(tempDir, 'included.txt'), 'should be included');

    const referenceFiles = new Map();

    const result = await scanForChanges(referenceFiles, mockLog);

    // .gitignore and included.txt should be found (ignored files are skipped)
    expect(result.changedFiles).toHaveLength(2);
    expect(result.changedFiles.some(f => f.path === 'included.txt')).toBe(true);
    expect(result.changedFiles.some(f => f.path === '.gitignore')).toBe(true);
  });

  test('handles missing .gitignore gracefully', async () => {
    const referenceFiles = new Map();
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');

    const result = await scanForChanges(referenceFiles, mockLog);

    expect(result.changedFiles).toHaveLength(1);
  });

  test('preserves nested paths in full scan - integration test for flattening bug', async () => {
    // Create a realistic project structure
    const srcDir = path.join(tempDir, 'src');
    const utilsDir = path.join(srcDir, 'utils');
    const componentsDir = path.join(srcDir, 'components');
    const testsDir = path.join(tempDir, 'tests');

    fs.mkdirSync(utilsDir, { recursive: true });
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    // Create files throughout the structure
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test');
    fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(srcDir, 'app.ts'), 'console.log("app");');
    fs.writeFileSync(path.join(utilsDir, 'helper.ts'), 'export function help() {}');
    fs.writeFileSync(path.join(componentsDir, 'Button.tsx'), 'export const Button = () => null;');
    fs.writeFileSync(path.join(testsDir, 'test.ts'), 'it("works", () => {});');

    const referenceFiles = new Map();

    const result = await scanForChanges(referenceFiles, mockLog);

    // All files should be detected as new
    expect(result.changedFiles).toHaveLength(7);

    // Verify correct paths for each file
    const filesByPath = new Map(result.changedFiles.map(f => [f.path, f]));

    // Root files
    expect((filesByPath.get('package.json') as { content: string } | undefined)?.content).toBe(
      '{"name":"test"}'
    );
    expect((filesByPath.get('README.md') as { content: string } | undefined)?.content).toBe(
      '# Test'
    );

    // src/ files
    expect(
      (filesByPath.get(path.join('src', 'index.ts')) as { content: string } | undefined)?.content
    ).toBe('export {};');
    expect(
      (filesByPath.get(path.join('src', 'app.ts')) as { content: string } | undefined)?.content
    ).toBe('console.log("app");');

    // src/utils/ files
    expect(
      (filesByPath.get(path.join('src', 'utils', 'helper.ts')) as { content: string } | undefined)
        ?.content
    ).toBe('export function help() {}');

    // src/components/ files
    expect(
      (
        filesByPath.get(path.join('src', 'components', 'Button.tsx')) as
          | { content: string }
          | undefined
      )?.content
    ).toBe('export const Button = () => null;');

    // tests/ files
    expect(
      (filesByPath.get(path.join('tests', 'test.ts')) as { content: string } | undefined)?.content
    ).toBe('it("works", () => {});');

    // Ensure files are NOT flattened
    expect(filesByPath.has('helper.ts')).toBe(false);
    expect(filesByPath.has('Button.tsx')).toBe(false);
    expect(filesByPath.has('test.ts')).toBe(false);
    expect(filesByPath.has('index.ts')).toBe(false);
  });

  test('detects changes and deletions in nested directories - full integration test', async () => {
    const srcDir = path.join(tempDir, 'src');
    const utilsDir = path.join(srcDir, 'utils');
    const docsDir = path.join(tempDir, 'docs');

    fs.mkdirSync(utilsDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });

    // Create current state
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export {}; // modified');
    fs.writeFileSync(path.join(utilsDir, 'helper.ts'), 'export function newHelper() {}');
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide');

    // Reference has different state
    const referenceFiles = new Map([
      ['package.json', { sha: 'abc', content: '{"version":"0.9.0"}' }],
      [path.join('src', 'index.ts'), { sha: 'def', content: 'export {}; // old' }],
      [path.join('src', 'app.ts'), { sha: 'ghi', content: 'export const app = () => {}' }],
      [
        path.join('src', 'utils', 'helper.ts'),
        { sha: 'jkl', content: 'export function oldHelper() {}' },
      ],
      [path.join('docs', 'api.md'), { sha: 'mno', content: '# API Reference' }],
    ]);

    const result = await scanForChanges(referenceFiles, mockLog);

    // 3 modified, 1 new, 2 deleted
    expect(result.changedFiles).toHaveLength(4);
    expect(result.deletedFiles).toHaveLength(2);

    const changedByPath = new Map(result.changedFiles.map(f => [f.path, f]));

    // Modified files
    expect((changedByPath.get('package.json') as { content: string } | undefined)?.content).toBe(
      '{"version":"1.0.0"}'
    );
    expect(
      (changedByPath.get(path.join('src', 'index.ts')) as { content: string } | undefined)?.content
    ).toBe('export {}; // modified');
    expect(
      (changedByPath.get(path.join('src', 'utils', 'helper.ts')) as { content: string } | undefined)
        ?.content
    ).toBe('export function newHelper() {}');

    // New file
    expect(
      (changedByPath.get(path.join('docs', 'guide.md')) as { content: string } | undefined)?.content
    ).toBe('# Guide');

    // Deleted files
    expect(result.deletedFiles).toContain(path.join('src', 'app.ts'));
    expect(result.deletedFiles).toContain(path.join('docs', 'api.md'));

    // Ensure nested paths are preserved in deletions (not flattened)
    expect(result.deletedFiles).not.toContain('app.ts');
    expect(result.deletedFiles).not.toContain('api.md');
  });
});

describe('scanDirectory', () => {
  let tempDir: string;
  let mockLog: ReturnType<typeof createLogger>;

  beforeEach(() => {
    mockDebugLog.length = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-utils-scan-test-'));
    mockLog = createLogger('🔍');
  });

  test('scans single file', async () => {
    const testFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(testFile, 'content');

    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe('test.txt');
    expect(result.encounteredFiles.has('test.txt')).toBe(true);
  });

  test('scans nested directories', async () => {
    const subdir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root content');
    fs.writeFileSync(path.join(subdir, 'nested.txt'), 'nested content');

    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(2);
    expect(result.changedFiles.some(f => f.path === 'root.txt')).toBe(true);
    expect(result.changedFiles.some(f => f.path === path.join('subdir', 'nested.txt'))).toBe(true);
    expect(result.encounteredFiles.size).toBe(2);
  });

  test('preserves correct nested file paths - regression test for flattening bug', async () => {
    // Create a multi-level directory structure
    const level1 = path.join(tempDir, 'level1');
    const level2 = path.join(level1, 'level2');
    const level3 = path.join(level2, 'level3');
    fs.mkdirSync(level3, { recursive: true });

    // Create files at various nesting levels
    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root content');
    fs.writeFileSync(path.join(level1, 'file1.txt'), 'level1 content');
    fs.writeFileSync(path.join(level2, 'file2.txt'), 'level2 content');
    fs.writeFileSync(path.join(level3, 'file3.txt'), 'level3 content');

    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(4);

    // Verify each file has the correct nested path
    const rootFile = result.changedFiles.find(f => f.path === 'root.txt');
    expect(rootFile).toBeDefined();
    expect(rootFile!.content).toBe('root content');

    const level1File = result.changedFiles.find(f => f.path === path.join('level1', 'file1.txt'));
    expect(level1File).toBeDefined();
    expect(level1File!.content).toBe('level1 content');

    const level2File = result.changedFiles.find(
      f => f.path === path.join('level1', 'level2', 'file2.txt')
    );
    expect(level2File).toBeDefined();
    expect(level2File!.content).toBe('level2 content');

    const level3File = result.changedFiles.find(
      f => f.path === path.join('level1', 'level2', 'level3', 'file3.txt')
    );
    expect(level3File).toBeDefined();
    expect(level3File?.content).toBe('level3 content');

    // Ensure files are NOT flattened to root
    expect(result.changedFiles.find(f => f.path === 'file1.txt')).toBeUndefined();
    expect(result.changedFiles.find(f => f.path === 'file2.txt')).toBeUndefined();
    expect(result.changedFiles.find(f => f.path === 'file3.txt')).toBeUndefined();

    // Verify all files were encountered with correct paths
    expect(result.encounteredFiles.has('root.txt')).toBe(true);
    expect(result.encounteredFiles.has(path.join('level1', 'file1.txt'))).toBe(true);
    expect(result.encounteredFiles.has(path.join('level1', 'level2', 'file2.txt'))).toBe(true);
    expect(result.encounteredFiles.has(path.join('level1', 'level2', 'level3', 'file3.txt'))).toBe(
      true
    );
  });

  test('detects modified files in nested directories', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root same');
    fs.writeFileSync(path.join(nestedDir, 'nested.txt'), 'nested modified');

    const referenceFiles = new Map([
      ['root.txt', { sha: 'abc123', content: 'root same' }],
      [path.join('nested', 'nested.txt'), { sha: 'def456', content: 'old nested content' }],
    ]);

    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe(path.join('nested', 'nested.txt'));
    expect(result.changedFiles[0]!.content).toBe('nested modified');
  });

  test('detects deleted files in nested directories', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root content');
    fs.writeFileSync(path.join(nestedDir, 'remaining.txt'), 'remaining content');

    const referenceFiles = new Map([
      ['root.txt', { sha: 'abc123', content: 'root content' }],
      [path.join('nested', 'remaining.txt'), { sha: 'def456', content: 'remaining content' }],
      [path.join('nested', 'deleted.txt'), { sha: 'ghi789', content: 'deleted content' }],
      [path.join('nested', 'deep', 'also-deleted.txt'), { sha: 'jkl012', content: 'deep deleted' }],
    ]);

    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    // No changed files
    expect(result.changedFiles).toHaveLength(0);

    // But we tracked encountered files
    expect(result.encounteredFiles.has('root.txt')).toBe(true);
    expect(result.encounteredFiles.has(path.join('nested', 'remaining.txt'))).toBe(true);
    expect(result.encounteredFiles.has(path.join('nested', 'deleted.txt'))).toBe(false);
    expect(result.encounteredFiles.has(path.join('nested', 'deep', 'also-deleted.txt'))).toBe(
      false
    );
  });

  test('respects ignore patterns', async () => {
    fs.writeFileSync(path.join(tempDir, 'included.txt'), 'included');
    fs.writeFileSync(path.join(tempDir, 'excluded.txt'), 'excluded');

    const referenceFiles = new Map();
    const ig = ignore();
    ig.add('excluded.txt');

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]).toBeDefined();
    expect(result.changedFiles[0]?.path).toBe('included.txt');
    expect(result.encounteredFiles.has('included.txt')).toBe(true);
    expect(result.encounteredFiles.has('excluded.txt')).toBe(false);
  });

  test('compares files with reference', async () => {
    fs.writeFileSync(path.join(tempDir, 'unchanged.txt'), 'same');
    fs.writeFileSync(path.join(tempDir, 'changed.txt'), 'different');
    fs.writeFileSync(path.join(tempDir, 'new.txt'), 'new');

    const referenceFiles = new Map([
      ['unchanged.txt', { sha: 'abc123', content: 'same' }],
      ['changed.txt', { sha: 'def456', content: 'old' }],
      ['deleted.txt', { sha: 'ghi789', content: 'deleted' }],
    ]);

    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    // Should find changed.txt and new.txt as changed
    expect(result.changedFiles).toHaveLength(2);
    expect(result.changedFiles.some(f => f.path === 'changed.txt')).toBe(true);
    expect(result.changedFiles.some(f => f.path === 'new.txt')).toBe(true);

    // Should track all encountered files
    expect(result.encounteredFiles.has('unchanged.txt')).toBe(true);
    expect(result.encounteredFiles.has('changed.txt')).toBe(true);
    expect(result.encounteredFiles.has('new.txt')).toBe(true);
  });

  test('handles empty directory', async () => {
    const referenceFiles = new Map();
    const ig = ignore();

    const result = await scanDirectory({
      dir: tempDir,
      relativePath: '',
      referenceFiles,
      ig,
      log: mockLog,
    });

    expect(result.changedFiles).toHaveLength(0);
    expect(result.encounteredFiles.size).toBe(0);
  });
});
