import { spawnSync } from 'child_process';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_MENTION, PI_BRANCH_PREFIX } from './constants.js';

// ── CLI Helper ───────────────────────────────────────────────────
/**
 * Runs a shell command and returns its output.
 * @param cmd - The command and arguments to run
 * @param options - Optional configuration (input, timeout, stdio)
 * @param env - Optional environment variables to override
 * @returns The stdout output from the command
 * @throws Error if the command exits with a non-zero status
 */
export function runCommand(
  cmd: string[],
  options?: { input?: string; timeout?: number; stdio?: 'pipe' | 'inherit' },
  env?: NodeJS.ProcessEnv
): string {
  if (cmd.length === 0 || !cmd[0]) {
    throw new Error('Command cannot be empty');
  }

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: ['pipe', 'pipe', options?.stdio ?? 'pipe'],
    encoding: 'utf8',
    input: options?.input,
    timeout: options?.timeout,
    env: env ? { ...process.env, ...env } : { ...process.env },
  });

  if (result.status !== 0) {
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    throw new Error(
      `Command failed: ${cmd.join(' ')}\n\nExit code: ${result.status}\n\nStdout:\n${stdout}\n\nStderr:\n${stderr}`
    );
  }

  return (result.stdout || '').trim();
}

// ── Mention Helpers ───────────────────────────────────────────────
/**
 * Extracts the user prompt from a comment body by optionally removing the mention prefix.
 * @param body - The comment body text
 * @returns The extracted prompt, or the original body if no mention is found
 */
export function extractUserPrompt(body: string): string | null {
  const lower = body.toLowerCase().trim();
  const mentions = [DEFAULT_MENTION];
  for (const mention of mentions) {
    const idx = lower.indexOf(mention);
    if (idx !== -1) {
      const rest = body.slice(idx + mention.length).trim();
      return rest || null;
    }
  }
  return body.trim() || null;
}

/**
 * Generates a unique branch name for pi agent operations.
 * @param type - The type of operation (e.g., 'issue', 'pr')
 * @param issueNumber - The issue or PR number
 * @returns A unique branch name (e.g., 'pi/issue123-20260322123456')
 */
export function generateBranchName(type: string, issueNumber: number): string {
  const now = Temporal.Now.plainDateTimeISO();
  // Format: YYYYMMDDHHmmss
  const timestamp = `${now.year}${String(now.month).padStart(2, '0')}${String(now.day).padStart(2, '0')}${String(now.hour).padStart(2, '0')}${String(now.minute).padStart(2, '0')}${String(now.second).padStart(2, '0')}`;
  return `${PI_BRANCH_PREFIX}/${type}${issueNumber}-${timestamp}`;
}

// ── Environment Variables ───────────────────────────────────────
export interface EnvVar {
  key: string;
  value: string;
}

/**
 * Validates an environment variable key.
 * @param key - The key to validate
 * @returns true if valid, false otherwise
 */
function isValidEnvVarKey(key: string): boolean {
  // Env var keys must be non-empty, contain only alphanumeric chars and underscores,
  // and must not start with a number (POSIX convention)
  const envVarKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  return envVarKeyPattern.test(key);
}

/**
 * Parses environment variables from a multi-line string.
 * @param envVarsString - Multi-line string with KEY=VALUE pairs
 * @returns Array of parsed environment variable key-value pairs
 * @throws Error if any environment variable key is invalid
 */
export function parseEnvVars(envVarsString: string): EnvVar[] {
  if (!envVarsString?.trim()) {
    return [];
  }

  return envVarsString
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.includes('='))
    .map(line => {
      const equalIndex = line.indexOf('=');
      const key = line.slice(0, equalIndex).trim();
      const value = line.slice(equalIndex + 1).trim();

      if (!isValidEnvVarKey(key)) {
        throw new Error(
          `Invalid environment variable key '${key}': must start with a letter or underscore and contain only letters, numbers, and underscores`
        );
      }

      return { key, value };
    });
}
