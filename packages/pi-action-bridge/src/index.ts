/**
 * @file pi-action-bridge extension entry point.
 *
 * Registers the Octokit-backed tools:
 *   - `detect_pull_request` — resolve the PR for the current branch.
 *   - `post_pr_comment`     — post a comment (used by `/handoff`).
 *   - `read_pr_thread`      — read a PR thread (used by `/pickup`).
 *
 * Prompt templates (`/handoff`, `/pickup`) are declared in `package.json`
 * under `pi.prompts`.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { detectPullRequestTool } from './tools/detect-pull-request';
import { postPrCommentTool } from './tools/post-pr-comment';
import { readPrThreadTool } from './tools/read-pr-thread';

export { detectPullRequestTool, detectPullRequest, summarize } from './tools/detect-pull-request';
export { postPrCommentTool, postPrComment, summarizePostComment } from './tools/post-pr-comment';
export { readPrThreadTool, readPrThread, summarizeThread } from './tools/read-pr-thread';
export { parseRemoteUrl } from './remote';
export {
  postIssueComment,
  readIssueThread,
  normalizeComment,
  createOctokit,
  createOctokitFromEnv,
  createOctokitFindPr,
  createOctokitPostComment,
  createOctokitReadThread,
} from './octokit';
export type {
  DetectPullRequestDetails,
  NormalizedPR,
  NoPrReason,
  RepoInfo,
  NormalizedComment,
  NormalizedThread,
  PostPrCommentDetails,
  ReadPrThreadDetails,
} from './types';

export default function piActionBridge(pi: ExtensionAPI): void {
  pi.registerTool(detectPullRequestTool);
  pi.registerTool(postPrCommentTool);
  pi.registerTool(readPrThreadTool);
}
