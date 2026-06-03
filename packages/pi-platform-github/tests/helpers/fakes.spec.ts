/**
 * Tests for the test fakes module.
 *
 * Verifies that fake data structures match expected formats and can be created
 * with default or custom values.
 */

import { describe, expect, test } from 'bun:test';
import {
  createFakeIssue,
  createFakePullRequest,
  createFakeComment,
  createFakeBotComment,
  createFakeGitHubContext,
  createFakeIssueCommentPayload,
  createFakeIssuePayload,
  createFakePRPayload,
  createFakeThread,
  createFakeThreadComment,
  createFakeOctokitIssue,
  createFakeOctokitPR,
  createFakeOctokitComment,
  createFakeOctokitComments,
  createFakeOctokitRepository,
  createFakeOctokitReaction,
  createFakeOctokitPRCreate,
  createFakeOctokitResponse,
  createFakeOctokitPaginatedResponse,
  createFake404Error,
  createFakeHttpError,
} from './fakes';

describe('Fake GitHub Context', () => {
  test('createFakeIssue creates default issue', () => {
    const issue = createFakeIssue();
    expect(issue.id).toBe(1);
    expect(issue.number).toBe(42);
    expect(issue.title).toBe('Test Issue');
    expect(issue.body).toBe('This is a test issue.');
    expect(issue.user?.login).toBe('testuser');
    expect(issue.user?.type).toBe('User');
    expect(issue.state).toBe('open');
  });

  test('createFakeIssue accepts overrides', () => {
    const issue = createFakeIssue({
      number: 999,
      title: 'Custom Title',
      body: null,
      state: 'closed',
    });
    expect(issue.number).toBe(999);
    expect(issue.title).toBe('Custom Title');
    expect(issue.body).toBeNull();
    expect(issue.state).toBe('closed');
  });

  test('createFakePullRequest creates default PR', () => {
    const pr = createFakePullRequest();
    expect(pr.id).toBe(1);
    expect(pr.number).toBe(123);
    expect(pr.title).toBe('Test PR');
    expect(pr.body).toBe('This is a test PR.');
    expect(pr.head.ref).toBe('feature/test');
    expect(pr.base.ref).toBe('main');
    expect(pr.merged_at).toBeNull();
  });

  test('createFakeComment creates default comment', () => {
    const comment = createFakeComment();
    expect(comment.id).toBe(12345);
    expect(comment.body).toBe('/pi test');
    expect(comment.user?.login).toBe('testuser');
    expect(comment.user?.type).toBe('User');
  });

  test('createFakeComment accepts custom body', () => {
    const comment = createFakeComment('/pi Help me');
    expect(comment.body).toBe('/pi Help me');
  });

  test('createFakeBotComment creates bot comment', () => {
    const comment = createFakeBotComment();
    expect(comment.user?.type).toBe('Bot');
    expect(comment.user?.login).toBe('github-actions[bot]');
  });

  test('createFakeGitHubContext creates default context', () => {
    const context = createFakeGitHubContext();
    expect(context.eventName).toBe('issue_comment');
    expect(context.payload.comment).toBeDefined();
    expect(context.payload.issue).toBeDefined();
    expect(context.repo.owner).toBe('test-owner');
    expect(context.repo.repo).toBe('test-repo');
    expect(context.serverUrl).toBe('https://github.com');
    expect(context.runId).toBe(123456789);
  });

  test('createFakeGitHubContext accepts different event types', () => {
    const context = createFakeGitHubContext('pull_request');
    expect(context.eventName).toBe('pull_request');
  });

  test('createFakeIssueCommentPayload creates issue_comment payload', () => {
    const payload = createFakeIssueCommentPayload('/pi test');
    expect(payload.comment?.body).toBe('/pi test');
    expect(payload.issue?.number).toBe(42);
    expect(payload.repository?.default_branch).toBe('main');
  });

  test('createFakeIssuePayload creates issues payload', () => {
    const payload = createFakeIssuePayload('New Issue');
    expect(payload.issue?.title).toBe('New Issue');
    expect(payload.issue?.body).toBe('Issue description');
  });

  test('createFakePRPayload creates pull_request payload', () => {
    const payload = createFakePRPayload('New PR');
    expect(payload.pull_request?.title).toBe('New PR');
    expect(payload.pull_request?.body).toBe('PR description');
  });
});

describe('Fake Octokit Responses', () => {
  test('createFakeOctokitIssue creates default issue response', () => {
    const issue = createFakeOctokitIssue();
    expect(issue.id).toBe(1);
    expect(issue.number).toBe(42);
    expect(issue.title).toBe('Test Issue');
    expect(issue.user?.login).toBe('testuser');
    expect(issue.user?.type).toBe('User');
    expect(issue.state).toBe('open');
  });

  test('createFakeOctokitPR creates default PR response', () => {
    const pr = createFakeOctokitPR();
    expect(pr.id).toBe(1);
    expect(pr.number).toBe(123);
    expect(pr.title).toBe('Test PR');
    expect(pr.head.ref).toBe('feature/test');
    expect(pr.base.ref).toBe('main');
  });

  test('createFakeOctokitComment creates default comment response', () => {
    const comment = createFakeOctokitComment();
    expect(comment.id).toBe(12345);
    expect(comment.body).toBe('Test comment');
    expect(comment.user?.login).toBe('testuser');
  });

  test('createFakeOctokitComments creates array of comments from strings', () => {
    const comments = createFakeOctokitComments(['comment 1', 'comment 2', 'comment 3']);
    expect(comments).toHaveLength(3);
    expect(comments[0]?.body).toBe('comment 1');
    expect(comments[1]?.body).toBe('comment 2');
    expect(comments[2]?.body).toBe('comment 3');
  });

  test('createFakeOctokitComments creates array of comments from overrides', () => {
    const comments = createFakeOctokitComments([{ body: 'comment 1' }, { body: 'comment 2' }]);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toBe('comment 1');
    expect(comments[1]?.body).toBe('comment 2');
  });

  test('createFakeOctokitRepository creates default repository response', () => {
    const repo = createFakeOctokitRepository();
    expect(repo.id).toBe(1);
    expect(repo.name).toBe('test-repo');
    expect(repo.full_name).toBe('test-owner/test-repo');
    expect(repo.owner.login).toBe('test-owner');
    expect(repo.default_branch).toBe('main');
  });

  test('createFakeOctokitReaction creates default reaction response', () => {
    const reaction = createFakeOctokitReaction();
    expect(reaction.id).toBe(999);
    expect(reaction.content).toBe('eyes');
    expect(reaction.user.login).toBe('testuser');
  });

  test('createFakeOctokitReaction accepts custom reaction ID', () => {
    const reaction = createFakeOctokitReaction(12345);
    expect(reaction.id).toBe(12345);
  });

  test('createFakeOctokitPRCreate creates default PR creation response', () => {
    const pr = createFakeOctokitPRCreate();
    expect(pr.id).toBe(1);
    expect(pr.number).toBe(123);
    expect(pr.title).toBe('Test PR');
    expect(pr.html_url).toBe('https://github.com/test-owner/test-repo/pull/123');
  });
});

describe('Fake Octokit Response Helpers', () => {
  test('createFakeOctokitResponse wraps data', () => {
    const data = { id: 123, name: 'test' };
    const response = createFakeOctokitResponse(data);
    expect(response.data).toEqual(data);
  });

  test('createFakeOctokitPaginatedResponse creates paginated response', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const response = createFakeOctokitPaginatedResponse(items);
    expect(response.data).toEqual(items);
  });
});

describe('Fake Thread Data', () => {
  test('createFakeThread creates default thread', () => {
    const thread = createFakeThread();
    expect(thread.number).toBe(42);
    expect(thread.title).toBe('Test Issue');
    expect(thread.state).toBe('open');
    expect(thread.is_pull_request).toBe(false);
    expect(thread.comments).toEqual([]);
  });

  test('createFakeThread accepts overrides', () => {
    const thread = createFakeThread({
      number: 999,
      state: 'closed',
      is_pull_request: true,
    });
    expect(thread.number).toBe(999);
    expect(thread.state).toBe('closed');
    expect(thread.is_pull_request).toBe(true);
  });

  test('createFakeThreadComment creates default thread comment', () => {
    const comment = createFakeThreadComment();
    expect(comment.id).toBe(1);
    expect(comment.author).toBe('testuser');
    expect(comment.author_type).toBe('user');
    expect(comment.body).toBe('Test comment');
  });
});

describe('Fake Errors', () => {
  test('createFake404Error creates 404 error', () => {
    const error = createFake404Error();
    expect(error.message).toBe('Not Found');
    expect(error.status).toBe(404);
  });

  test('createFake404Error accepts custom message', () => {
    const error = createFake404Error('Resource not found');
    expect(error.message).toBe('Resource not found');
    expect(error.status).toBe(404);
  });

  test('createFakeHttpError creates HTTP error', () => {
    const error = createFakeHttpError(403, 'Forbidden');
    expect(error.message).toBe('Forbidden');
    expect(error.status).toBe(403);
  });

  test('createFakeHttpError creates default error message', () => {
    const error = createFakeHttpError(500);
    expect(error.message).toBe('HTTP Error');
    expect(error.status).toBe(500);
  });
});
