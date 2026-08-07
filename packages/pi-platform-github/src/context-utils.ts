/**
 * @file Shared utility functions for GitHub context operations.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import type { PlatformContext } from '@alexanderfortin/pi-orchestrator';
import type { GitHubModuleDeps } from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function repositoryFromPayload(payload: Record<string, unknown>): {
  owner?: string;
  repo?: string;
} {
  const repository = asRecord(payload.repository);
  if (!repository) {
    return {};
  }

  const fullName = asNonEmptyString(repository.full_name);
  if (fullName) {
    const parts = fullName.split('/');
    if (parts.length === 2) {
      const owner = asNonEmptyString(parts[0]);
      const repo = asNonEmptyString(parts[1]);
      if (owner && repo) {
        return { owner, repo };
      }
    }
  }

  const owner = asRecord(repository.owner);
  const ownerLogin = asNonEmptyString(owner?.login);
  const repoName = asNonEmptyString(repository.name);

  return {
    ...(ownerLogin ? { owner: ownerLogin } : {}),
    ...(repoName ? { repo: repoName } : {}),
  };
}

function issueNumberFromPayload(payload: Record<string, unknown>): number | undefined {
  const pullRequest = asRecord(payload.pull_request);
  const issue = asRecord(payload.issue);

  return (
    asPositiveInteger(pullRequest?.number) ??
    asPositiveInteger(issue?.number) ??
    asPositiveInteger(payload.number)
  );
}

/**
 * Recover repository and issue/PR identifiers from a webhook payload when a
 * frontend provides an incomplete platform context.
 *
 * Explicit context values always win. The payload is only a fallback so CLI
 * and non-Actions frontends can continue to supply their own context.
 */
export function resolvePlatformContext(context: PlatformContext): PlatformContext {
  const payloadRepository = repositoryFromPayload(context.payload);
  const owner = asNonEmptyString(context.repo.owner) ?? payloadRepository.owner ?? '';
  const repo = asNonEmptyString(context.repo.repo) ?? payloadRepository.repo ?? '';
  const issueNumber =
    asPositiveInteger(context.issue.number) ?? issueNumberFromPayload(context.payload) ?? 0;

  if (
    owner === context.repo.owner &&
    repo === context.repo.repo &&
    issueNumber === context.issue.number
  ) {
    return context;
  }

  return {
    ...context,
    repo: { owner, repo },
    issue: { number: issueNumber },
  };
}

/**
 * Determine if the current GitHub context is a pull request.
 *
 * @param deps - Module dependencies.
 * @returns `true` if the event type is `pull_request` or the payload contains a
 *          `pull_request` object.
 */
export function isPR(deps: GitHubModuleDeps): boolean {
  const { eventName, payload } = deps.context;
  return eventName === 'pull_request' || payload.pull_request !== undefined;
}

/**
 * Determine whether the current context originated from an issue or a pull
 * request.
 *
 * @param deps - Module dependencies.
 * @returns `'issue'`, `'pull_request'`, or `undefined` if the context cannot be
 *          classified.
 */
export function getContextType(deps: GitHubModuleDeps): 'issue' | 'pull_request' | undefined {
  if (isPR(deps)) {
    return 'pull_request';
  }
  if (deps.context.eventName === 'issue_comment' || deps.context.eventName === 'issues') {
    return 'issue';
  }
  return undefined;
}
