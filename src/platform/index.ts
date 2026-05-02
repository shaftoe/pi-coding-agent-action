/**
 * @file Platform module barrel export.
 *
 * Re-exports platform types and the default GitHub-compatible provider.
 * Future platform implementations (e.g. native GitLab, Bitbucket) can be
 * added here.
 */

export {
  type PlatformType,
  type PlatformContext,
  type PlatformProvider,
  type IssueOrPRThread,
  type ThreadComment,
  type ReviewComment,
  type GetIssueOrPRThreadParams,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
  type CreateReactionType,
} from './types';

export { detectPlatform, createGitHubPlatformProvider } from './github/index';
