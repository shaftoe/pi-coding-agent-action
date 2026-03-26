// ── Constants ─────────────────────────────────────────────────────

/**
 * Timeout for pi agent execution in milliseconds (60 minutes).
 */
export const PI_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Timeout for GitHub CLI operations in milliseconds (10 seconds).
 */
export const GH_TIMEOUT_MS = 10 * 1000;

/**
 * Default GitHub branch name.
 */
export const DEFAULT_GITHUB_BRANCH = 'main';

// ── Pi Agent Defaults ─────────────────────────────────────────────
/**
 * Default LLM provider for the pi agent.
 */
export const DEFAULT_PI_PROVIDER = 'anthropic';

/**
 * Default model for the pi agent.
 */
export const DEFAULT_PI_MODEL = 'claude-sonnet-4-5';

/**
 * Default mention trigger for the pi agent.
 */
export const DEFAULT_MENTION = '/pi';

// ── Git Constants ─────────────────────────────────────────────────
/**
 * Branch prefix for pi agent operations.
 */
export const PI_BRANCH_PREFIX = 'pi';

/**
 * Default committer name for git commits made by the pi agent.
 */
export const DEFAULT_COMMITTER_NAME = 'pi-agent[bot]';

/**
 * Default committer email for git commits made by the pi agent.
 */
export const DEFAULT_COMMITTER_EMAIL = 'pi-agent[bot]@users.noreply.github.com';

// ── GitHub API Constants ───────────────────────────────────────────
/**
 * GitHub reactions available for use.
 */
export const GITHUB_REACTIONS = [
  '+1',
  '-1',
  'laugh',
  'hooray',
  'confused',
  'heart',
  'rocket',
  'eyes',
] as const;

/**
 * Type of GitHub reaction.
 */
export type GitHubReaction = (typeof GITHUB_REACTIONS)[number];

// ── Temp File Constants ────────────────────────────────────────────
/**
 * Base name for the pi prompt temp file.
 */
export const PROMPT_TEMP_FILE = 'pi_prompt.md';

/**
 * Prefix for the pi system prompt temp file.
 */
export const SYSTEM_PROMPT_TEMP_FILE_PREFIX = 'pi_system';

// ── Commit Message Constants ────────────────────────────────────────────
/**
 * Patterns to exclude from commit message summaries.
 * These are common generic phrases that AI assistants use.
 */
export const GENERIC_COMMIT_PREFIXES = [
  'I',
  "I'll",
  'Sure',
  'OK',
  'Great',
  'Here',
  'The',
  'This',
  'A',
] as const;

/**
 * Regex pattern for matching generic commit message prefixes.
 */
export const GENERIC_PREFIX_PATTERN = new RegExp(
  `^(${GENERIC_COMMIT_PREFIXES.join('|')})`,
  'i'
);

/**
 * Maximum length for a commit message subject line.
 */
export const MAX_COMMIT_SUBJECT_LENGTH = 72;

/**
 * Recommended length for a commit message subject line.
 */
export const RECOMMENDED_COMMIT_SUBJECT_LENGTH = 50;

// ── Formatting Constants ───────────────────────────────────────────────
/**
 * Indentation for issue comments in prompts.
 */
export const ISSUE_COMMENT_INDENT = '  - ';

/**
 * Indentation for PR comments in prompts.
 */
export const PR_COMMENT_INDENT = '- ';

/**
 * Indentation for review comments in prompts.
 */
export const REVIEW_COMMENT_INDENT = '    - ';

// ── Validation Constants ───────────────────────────────────────────────
/**
 * Maximum length for a user prompt.
 */
export const MAX_USER_PROMPT_LENGTH = 100_000;

/**
 * Maximum length for an environment variable value.
 */
export const MAX_ENV_VAR_VALUE_LENGTH = 32_760;

/**
 * Maximum length for an environment variable key.
 */
export const MAX_ENV_VAR_KEY_LENGTH = 255;

/**
 * Maximum length for a branch name.
 */
export const MAX_BRANCH_NAME_LENGTH = 255;

/**
 * Maximum length for a commit message.
 */
export const MAX_COMMIT_MESSAGE_LENGTH = 72 * 1024; // ~72KB

/**
 * Maximum length for a GitHub username.
 */
export const MAX_GITHUB_USERNAME_LENGTH = 39;

/**
 * Maximum length for a GitHub repository name.
 */
export const MAX_REPOSITORY_NAME_LENGTH = 100;

/**
 * Maximum issue/PR number (2^31 - 1).
 */
export const MAX_ISSUE_NUMBER = 2_147_483_647;
