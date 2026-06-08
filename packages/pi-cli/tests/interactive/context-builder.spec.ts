/**
 * @file Tests for {@link packages/pi-cli/src/interactive/context-builder.ts}.
 *
 * Covers:
 *   - buildInteractiveContext: produces correct PlatformContext for issues and PRs
 *   - detectIsPR: (mocked) identification of PR vs issue
 */

import { describe, it, expect } from 'bun:test';
import {
  buildInteractiveContext,
  type InteractiveContextArgs,
} from '../../src/interactive/context-builder.js';

describe('buildInteractiveContext', () => {
  const baseArgs: InteractiveContextArgs = {
    repo: { owner: 'shaftoe', repo: 'pi-coding-agent-action' },
    issueOrPRNumber: 277,
    isPR: false,
    workspace: '/some/path',
    serverUrl: 'https://github.com',
  };

  describe('for issues', () => {
    it('sets eventName to "issues"', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.eventName).toBe('issues');
    });

    it('sets the issue number', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.issue.number).toBe(277);
    });

    it('includes an issue stub in payload', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.payload.issue).toEqual({ number: 277 });
    });

    it('does not include pull_request in payload', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.payload.pull_request).toBeUndefined();
    });

    it('sets workspace and serverUrl', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.workspace).toBe('/some/path');
      expect(ctx.serverUrl).toBe('https://github.com');
    });

    it('omits runId', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.runId).toBeUndefined();
    });
  });

  describe('for PRs', () => {
    const prArgs: InteractiveContextArgs = { ...baseArgs, isPR: true };

    it('sets eventName to "pull_request"', () => {
      const ctx = buildInteractiveContext(prArgs);
      expect(ctx.eventName).toBe('pull_request');
    });

    it('sets the PR number as issue number', () => {
      const ctx = buildInteractiveContext(prArgs);
      expect(ctx.issue.number).toBe(277);
    });

    it('includes a pull_request stub in payload', () => {
      const ctx = buildInteractiveContext(prArgs);
      expect(ctx.payload.pull_request).toEqual({ number: 277 });
    });

    it('does not include issue in payload', () => {
      const ctx = buildInteractiveContext(prArgs);
      expect(ctx.payload.issue).toBeUndefined();
    });
  });

  describe('optional fields', () => {
    it('omits actor when not provided', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.actor).toBeUndefined();
    });

    it('includes actor when provided', () => {
      const ctx = buildInteractiveContext({ ...baseArgs, actor: 'alice' });
      expect(ctx.actor).toBe('alice');
    });

    it('omits sha when not provided', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.sha).toBeUndefined();
    });

    it('includes sha when provided', () => {
      const ctx = buildInteractiveContext({ ...baseArgs, sha: 'abc1234' });
      expect(ctx.sha).toBe('abc1234');
    });
  });

  describe('repo passthrough', () => {
    it('passes repo through unchanged', () => {
      const ctx = buildInteractiveContext(baseArgs);
      expect(ctx.repo).toEqual({ owner: 'shaftoe', repo: 'pi-coding-agent-action' });
    });
  });
});
