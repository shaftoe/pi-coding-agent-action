import * as core from '@actions/core';
import { spawnSync } from 'child_process';

// ── CLI Helper ───────────────────────────────────────────────────
/**
 * Runs a shell command and returns its output.
 * @param cmd - The command and arguments to run
 * @param options - Optional input to provide to stdin
 * @param env - Optional environment variables to override
 * @returns The stdout output from the command
 * @throws Error if the command exits with a non-zero status
 */
export function runCommand(
  cmd: string[],
  options?: { input?: string },
  env?: NodeJS.ProcessEnv
): string {
  core.info(`Running: ${cmd.join(' ')}`);

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    input: options?.input,
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
 * Gets the list of configured mentions from action inputs.
 * @returns Array of mention strings (e.g., ['/pi', '@bot'])
 */
export function getMentions(): string[] {
  const raw = core.getInput('mentions') || '/pi';
  return raw.split(',').map(m => m.trim().toLowerCase());
}

/**
 * Asserts that the comment body contains one of the required mentions.
 * @param body - The comment body text
 * @throws Error if no matching mention is found
 */
export function assertKeyword(body: string): void {
  const lower = body.toLowerCase().trim();
  const mentions = getMentions();
  const matched = mentions.some(
    m =>
      lower === m ||
      lower.startsWith(m + ' ') ||
      lower.includes(' ' + m + ' ') ||
      lower.endsWith(' ' + m)
  );
  if (!matched) {
    const message = `Comment must contain one of: ${mentions.join(', ')}`;
    core.setFailed(message);
    throw new Error(message);
  }
}

/**
 * Extracts the user prompt from a comment body by removing the mention prefix.
 * @param body - The comment body text
 * @returns The extracted prompt, or null if the comment only contains a mention
 */
export function extractUserPrompt(body: string): string | null {
  const lower = body.toLowerCase().trim();
  const mentions = getMentions();
  for (const mention of mentions) {
    const idx = lower.indexOf(mention);
    if (idx !== -1) {
      const rest = body.slice(idx + mention.length).trim();
      return rest || null;
    }
  }
  return null;
}

/**
 * Generates a unique branch name for pi agent operations.
 * @param type - The type of operation (e.g., 'issue', 'pr')
 * @param issueNumber - The issue or PR number
 * @returns A unique branch name (e.g., 'pi/issue123-20260322123456')
 */
export function generateBranchName(type: string, issueNumber: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `pi/${type}${issueNumber}-${year}${month}${day}${hours}${minutes}${seconds}`;
}

// ── Environment Variables ───────────────────────────────────────
export interface EnvVar {
  key: string;
  value: string;
}

/**
 * Parses environment variables from a multi-line string.
 * @param envVarsString - Multi-line string with KEY=VALUE pairs
 * @returns Array of parsed environment variable key-value pairs
 */
export function parseEnvVars(envVarsString: string): EnvVar[] {
  if (!envVarsString || envVarsString.trim() === '') {
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
      return { key, value };
    });
}
