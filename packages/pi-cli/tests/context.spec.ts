/**
 * @file Tests for {@link packages/pi-cli/src/context.ts}.
 *
 * Covers:
 *   - parseRepoFlag valid inputs and rejection of malformed values.
 *   - buildPlatformContext default fields and optional-field omission.
 *   - The 'cli' event name + sentinel `issue.number: 0` + empty payload
 *     that make M1 work without library changes.
 */

import { describe, it, expect } from 'bun:test';
import { buildPlatformContext, parseRepoFlag, CLI_EVENT_NAME } from '../src/context.js';

describe('parseRepoFlag', () => {
  it('parses owner/repo', () => {
    expect(parseRepoFlag('shaftoe/pi-coding-agent-action')).toEqual({
      owner: 'shaftoe',
      repo: 'pi-coding-agent-action',
    });
  });

  it('accepts dashes in both segments', () => {
    expect(parseRepoFlag('my-org/my-repo')).toEqual({
      owner: 'my-org',
      repo: 'my-repo',
    });
  });

  it('accepts dots (orgs like foo.config / repos like foo.config)', () => {
    expect(parseRepoFlag('foo.config/bar')).toEqual({
      owner: 'foo.config',
      repo: 'bar',
    });
    expect(parseRepoFlag('foo/bar.config')).toEqual({
      owner: 'foo',
      repo: 'bar.config',
    });
  });

  it('accepts underscores', () => {
    expect(parseRepoFlag('snake_case/repo_name')).toEqual({
      owner: 'snake_case',
      repo: 'repo_name',
    });
  });

  it('rejects missing slash', () => {
    expect(() => parseRepoFlag('nobracket')).toThrow(/Expected format/);
  });

  it('rejects multiple slashes', () => {
    expect(() => parseRepoFlag('a/b/c')).toThrow(/Expected format/);
  });

  it('rejects empty owner', () => {
    expect(() => parseRepoFlag('/repo')).toThrow(/Expected format/);
  });

  it('rejects empty repo', () => {
    expect(() => parseRepoFlag('owner/')).toThrow(/Expected format/);
  });

  it('rejects spaces in owner', () => {
    expect(() => parseRepoFlag('bad owner/repo')).toThrow(/Expected format/);
  });

  it('includes the offending value in the error message', () => {
    expect(() => parseRepoFlag('garbage')).toThrow(/'garbage'/);
  });

  describe('.git stripping', () => {
    it('strips trailing .git from owner/repo.git', () => {
      expect(parseRepoFlag('org/repo.git')).toEqual({
        owner: 'org',
        repo: 'repo',
      });
    });

    it('strips trailing .git from owner/repo with dashes', () => {
      expect(parseRepoFlag('my-org/my-repo.git')).toEqual({
        owner: 'my-org',
        repo: 'my-repo',
      });
    });

    it('strips .git even with dots in repo name', () => {
      expect(parseRepoFlag('org/collection.config.git')).toEqual({
        owner: 'org',
        repo: 'collection.config',
      });
    });

    it('does not strip .notgit', () => {
      expect(parseRepoFlag('org/repo.notgit')).toEqual({
        owner: 'org',
        repo: 'repo.notgit',
      });
    });
  });
});

describe('buildPlatformContext', () => {
  const baseArgs = {
    repo: { owner: 'shaftoe', repo: 'pi-coding-agent-action' },
    workspace: '/some/path',
    serverUrl: 'https://github.com',
  };

  it('returns the canonical sentinel shape for M1', () => {
    const ctx = buildPlatformContext(baseArgs);
    expect(ctx.repo).toEqual({ owner: 'shaftoe', repo: 'pi-coding-agent-action' });
    expect(ctx.eventName).toBe(CLI_EVENT_NAME);
    expect(ctx.eventName).toBe('cli');
    expect(ctx.issue).toEqual({ number: 0 }); // sentinel: createComment() will no-op
    expect(ctx.payload).toEqual({}); // empty: no triggering comment
    expect(ctx.serverUrl).toBe('https://github.com');
    expect(ctx.workspace).toBe('/some/path');
  });

  it('omits runId so comment footers do not link to nonexistent Actions runs', () => {
    // buildActionRunUrl() returns undefined when runId is falsy/missing,
    // suppressing the "View action run" footer. See context.ts docstring.
    const ctx = buildPlatformContext(baseArgs);
    expect(ctx.runId).toBeUndefined();
  });

  it('omits optional actor when not provided', () => {
    const ctx = buildPlatformContext(baseArgs);
    expect(ctx.actor).toBeUndefined();
  });

  it('includes actor when provided', () => {
    const ctx = buildPlatformContext({ ...baseArgs, actor: 'alice' });
    expect(ctx.actor).toBe('alice');
  });

  it('omits optional sha when not provided', () => {
    const ctx = buildPlatformContext(baseArgs);
    expect(ctx.sha).toBeUndefined();
  });

  it('includes sha when provided', () => {
    const ctx = buildPlatformContext({ ...baseArgs, sha: 'abc1234' });
    expect(ctx.sha).toBe('abc1234');
  });
});
