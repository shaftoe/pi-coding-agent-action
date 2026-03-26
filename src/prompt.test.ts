import { describe, expect, test } from 'bun:test';
import {
  SYSTEM_PROMPT,
  PULL_REQUEST_TOOL,
  PR_BODY,
  PR_ERRORS,
  PR_SUCCESS,
  TOOL_EXECUTION,
  TOOL_REGISTRATION,
  PR_DEBUG,
} from './prompt';

describe('SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test('mentions GitHub Actions context', () => {
    expect(SYSTEM_PROMPT).toContain('GitHub Actions');
  });

  test('mentions code review', () => {
    expect(SYSTEM_PROMPT).toContain('code review');
  });

  test('mentions non-interactive nature', () => {
    expect(SYSTEM_PROMPT).toContain('non-interactive');
  });
});

describe('PULL_REQUEST_TOOL', () => {
  test('has correct name', () => {
    expect(PULL_REQUEST_TOOL.name).toBe('create_pull_request');
  });

  test('has correct label', () => {
    expect(PULL_REQUEST_TOOL.label).toBe('Create Pull Request');
  });

  test('has description', () => {
    expect(typeof PULL_REQUEST_TOOL.description).toBe('string');
    expect(PULL_REQUEST_TOOL.description.length).toBeGreaterThan(0);
  });

  test('has prompt snippet', () => {
    expect(typeof PULL_REQUEST_TOOL.promptSnippet).toBe('string');
    expect(PULL_REQUEST_TOOL.promptSnippet.length).toBeGreaterThan(0);
  });

  test('has guidelines array', () => {
    expect(Array.isArray(PULL_REQUEST_TOOL.guidelines)).toBe(true);
    expect(PULL_REQUEST_TOOL.guidelines.length).toBeGreaterThan(0);
  });

  test('has parameter descriptions', () => {
    expect(PULL_REQUEST_TOOL.parameters).toBeDefined();
    expect(PULL_REQUEST_TOOL.parameters.title).toBeDefined();
    expect(PULL_REQUEST_TOOL.parameters.body).toBeDefined();
    expect(PULL_REQUEST_TOOL.parameters.base).toBeDefined();
    expect(PULL_REQUEST_TOOL.parameters.dryRun).toBeDefined();
  });

  test('title parameter description mentions conventional commit', () => {
    expect(PULL_REQUEST_TOOL.parameters.title.description).toContain('conventional commit');
  });

  test('base parameter description mentions EXPERT', () => {
    expect(PULL_REQUEST_TOOL.parameters.base.description).toContain('EXPERT');
  });
});

describe('PR_BODY', () => {
  test('fromIssue generates correct body', () => {
    const body = PR_BODY.fromIssue(42);
    expect(body).toContain('#42');
    expect(body).toContain('pi coding agent');
    expect(body).toContain('Fixes');
  });

  test('fromPullRequest generates correct body', () => {
    const body = PR_BODY.fromPullRequest(123);
    expect(body).toContain('#123');
    expect(body).toContain('pi coding agent');
    expect(body).toContain('Related to');
  });

  test('differentiates between issue and PR', () => {
    const issueBody = PR_BODY.fromIssue(42);
    const prBody = PR_BODY.fromPullRequest(42);
    expect(issueBody).toContain('Fixes');
    expect(prBody).toContain('Related to');
    expect(issueBody).not.toBe(prBody);
  });
});

describe('PR_ERRORS', () => {
  test('noChangesDetected is a non-empty string', () => {
    expect(typeof PR_ERRORS.noChangesDetected).toBe('string');
    expect(PR_ERRORS.noChangesDetected.length).toBeGreaterThan(0);
  });

  test('creationFailed formats message correctly', () => {
    const errorMsg = PR_ERRORS.creationFailed('test error');
    expect(errorMsg).toContain('create_pull_request');
    expect(errorMsg).toContain('Failed to create pull request');
    expect(errorMsg).toContain('test error');
  });
});

describe('PR_SUCCESS', () => {
  test('pullRequestCreated formats message correctly', () => {
    const msg = PR_SUCCESS.pullRequestCreated(42, 'https://example.com/pr/42');
    expect(msg).toContain('42');
    expect(msg).toContain('https://example.com/pr/42');
    expect(msg).toContain('created');
  });

  test('dryRunPrefix is correct', () => {
    expect(PR_SUCCESS.dryRunPrefix).toBe('[DRY RUN]');
  });

  test('dryRunMessage formats message correctly', () => {
    const msg = PR_SUCCESS.dryRunMessage('test title', 'test body', 'main', 'pi/issue123-456');
    expect(msg).toContain('[DRY RUN]');
    expect(msg).toContain('test title');
    expect(msg).toContain('test body');
    expect(msg).toContain('main');
    expect(msg).toContain('pi/issue123-456');
  });
});

describe('TOOL_EXECUTION', () => {
  test('createPullRequest cancelled message', () => {
    expect(TOOL_EXECUTION.createPullRequest.cancelled).toContain('cancelled');
  });

  test('createPullRequest called message', () => {
    expect(TOOL_EXECUTION.createPullRequest.called).toContain('create_pull_request tool called');
  });
});

describe('TOOL_REGISTRATION', () => {
  test('createPullRequest message', () => {
    expect(TOOL_REGISTRATION.createPullRequest).toContain('create_pull_request');
    expect(TOOL_REGISTRATION.createPullRequest).toContain('registered');
  });
});

describe('PR_DEBUG', () => {
  test('title formats correctly', () => {
    const msg = PR_DEBUG.title('test title');
    expect(msg).toContain('Title:');
    expect(msg).toContain('test title');
  });

  test('autoGeneratedBranch formats correctly', () => {
    const msg = PR_DEBUG.autoGeneratedBranch('pi/issue123-456');
    expect(msg).toContain('Auto-generated branch:');
    expect(msg).toContain('pi/issue123-456');
  });

  test('base formats correctly', () => {
    const msg = PR_DEBUG.base('main');
    expect(msg).toContain('Base:');
    expect(msg).toContain('main');
  });

  test('dryRun formats correctly', () => {
    const msg = PR_DEBUG.dryRun(true);
    expect(msg).toContain('DryRun:');
    expect(msg).toContain('true');
  });

  test('foundChangedFiles formats correctly', () => {
    const msg = PR_DEBUG.foundChangedFiles(5);
    expect(msg).toContain('5');
    expect(msg).toContain('changed file');
  });

  test('creatingBranch formats correctly', () => {
    const msg = PR_DEBUG.creatingBranch('pi/issue123-456');
    expect(msg).toContain('Creating new branch');
    expect(msg).toContain('pi/issue123-456');
  });

  test('createdBlob formats correctly', () => {
    const msg = PR_DEBUG.createdBlob('test.ts', 'abc123');
    expect(msg).toContain('test.ts');
    expect(msg).toContain('abc123');
  });
});
