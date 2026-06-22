/**
 * @file @alexanderfortin/pi-orchestrator barrel export.
 *
 * Re-exports the public API of the core orchestrator package.
 */

// Core business logic
export { ActionOrchestrator, buildSessionSuccessBody, buildSessionErrorBody } from './orchestrator';

// Formatting helpers
export { formatCost } from './format';

// Agent
export { Agent } from './pi';
export { createToolsFactory } from './pi/tools';
export { createCancellationResult, withCancellation, buildParams } from './pi/tools/tool-execution';
export type { CancellationResult, ToolExecutionConfig } from './pi/tools/tool-execution';
export {
  formatThreadAsText,
  formatThreadHeader,
  formatThreadTimestamps,
  formatThreadLabels,
  formatPRFields,
  formatThreadBody,
  formatThreadComments,
  formatReviewComments,
} from './pi/tools/common';
export {
  createLoggingFactory,
  truncateText,
  formatLLMSection,
  formatExtensionsSection,
  formatToolsSection,
  formatSystemPromptSection,
  formatUserPromptSection,
  formatCompactionSection,
} from './pi/logging';
export type {
  ExtensionLoadingInfo,
  LogLine,
  CompactionReason,
  CompactionSectionInput,
} from './pi/logging';
export { resolveExtensions, getResourceLoader } from './pi/resource-loader';
export { createPRToolFactory } from './pi/tools/create-pr';
export { createReviewToolFactory } from './pi/tools/create-review';
export { getCIStatusToolFactory } from './pi/tools/get-ci-status';
export { getPRDiffToolFactory } from './pi/tools/get-pr-diff';
export { getIssueOrPRThreadToolFactory } from './pi/tools/get-thread';
export { getWorkflowRunLogsToolFactory } from './pi/tools/get-workflow-run-logs';
export { updatePullRequestToolFactory } from './pi/tools/update-pr';

// Version
export { getActionVersion, getPiVersion, formatActionVersion } from './version';
export type { ActionBuildInfo } from './version';

// Session sharing (gist)
export { createSessionGist } from './share/gist';
export type { CreateGistInput, CreatedGist } from './share/gist';

// Types
export type {
  Logger,
  OutputSink,
  PiConfig,
  PiAgent,
  PiAgentFactory,
  GitAdapter,
  CoreAdapter,
  CommentMetadata,
  AgentEvents,
  SessionStats,
  DiffConfig,
  ResourceLoaderConfig,
} from './types';

// Platform types (abstract interfaces)
export type {
  PlatformType,
  PlatformContext,
  PlatformProvider,
  IssueOrPullRequestContext,
  IssueOrPRThread,
  ThreadComment,
  ReviewComment,
  GetIssueOrPRThreadParams,
  CreatePullRequestParams,
  CreatePullRequestDetails,
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  CreateReactionType,
  CreateReviewParams,
  CreateReviewDetails,
  ReviewInlineComment,
  GetCIStatusParams,
  GetCIStatusDetails,
  CheckRunResult,
  WorkflowRunResult,
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
  JobLog,
} from './platform';

// Git utilities (platform-agnostic)
export type { Logger as GitLogger, FileMode, TreeEntry } from './git';
export { FILE_MODE_DIRECTORY, FILE_MODE_EXECUTABLE, FILE_MODE_REGULAR } from './git';
export type { ChangeScanResult, ScanDirectoryParams, ScanOptions } from './git';
export { scanForChanges, scanDirectory } from './git';
