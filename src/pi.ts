import * as core from '@actions/core';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'node:crypto';
import { parseEnvVars, runCommand } from './utils.js';
import {
  PI_TIMEOUT_MS,
  DEFAULT_PI_PROVIDER,
  DEFAULT_PI_MODEL,
  PROMPT_TEMP_FILE,
  SYSTEM_PROMPT_TEMP_FILE_PREFIX,
  GENERIC_PREFIX_PATTERN,
  RECOMMENDED_COMMIT_SUBJECT_LENGTH,
  MAX_COMMIT_SUBJECT_LENGTH,
} from './constants.js';

// ── Helpers ──────────────────────────────────────────────────
/**
 * Safely removes a file if it exists, logging any errors as debug messages.
 * @param filePath - The path to the file to remove
 */
function safeRemoveFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    // Log warnings for cleanup failures to aid in debugging
    // Don't throw to avoid masking original errors in the try-finally block
    const errorMsg = e instanceof Error ? e.message : String(e);
    core.warning(`Failed to clean up temp file ${filePath}: ${errorMsg}`);
  }
}

// ── Run Pi Agent ───────────────────────────────────────────
/**
 * Extracts Pi agent configuration from GitHub Actions inputs.
 * @returns Configuration object with provider, model, tools, and prompt settings
 */
function getPiConfig() {
  return {
    provider: core.getInput('provider') ?? DEFAULT_PI_PROVIDER,
    model: core.getInput('model') ?? DEFAULT_PI_MODEL,
    extraTools: core.getInput('extra_tools') ?? '',
    customSystemPrompt: core.getInput('prompt') ?? '',
    envVarsString: core.getInput('env_vars') ?? '',
  };
}

/**
 * Builds command line arguments for the pi agent.
 * @param config - The pi agent configuration
 * @param promptFile - Path to the temp prompt file
 * @returns Array of command line arguments
 */
function buildPiArgs(config: ReturnType<typeof getPiConfig>, promptFile: string): string[] {
  const args = [
    '--provider',
    config.provider,
    '--model',
    config.model,
    '-p', // print / non-interactive mode
    `@${promptFile}`,
  ];

  if (config.extraTools) {
    args.push('--tools', config.extraTools);
  }

  return args;
}

/**
 * Writes the custom system prompt to a temp file.
 * @param customSystemPrompt - The custom system prompt content
 * @returns Path to the temp file, or empty string if no custom prompt
 */
function prepareSystemPromptFile(customSystemPrompt: string): string {
  if (!customSystemPrompt) {
    return '';
  }

  // Write SYSTEM.md to a temp file to avoid conflicts
  // Use UUID for better uniqueness than Date.now()
  const systemPromptFile = path.join(
    os.tmpdir(),
    `${SYSTEM_PROMPT_TEMP_FILE_PREFIX}_${crypto.randomUUID()}.md`
  );
  fs.writeFileSync(systemPromptFile, customSystemPrompt, 'utf8');
  return systemPromptFile;
}

/**
 * Builds the environment variables for running pi.
 * @param envVars - Array of environment variable key-value pairs
 * @returns Environment object for the command
 */
function buildPiEnv(envVars: Array<{ key: string; value: string }>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { key, value } of envVars) {
    core.info(`Setting env var: ${key}=***`);
    env[key] = value;
  }
  return env;
}

/**
 * Runs the pi agent with the given prompt.
 * @param prompt - The prompt to send to pi
 * @param overrideProvider - Optional provider override (for internal calls)
 * @param overrideModel - Optional model override (for internal calls)
 * @returns The response from pi
 * @throws Error if pi exits with non-zero status
 */
export function runPi(prompt: string, overrideProvider?: string, overrideModel?: string): string {
  const config = getPiConfig();
  const provider = overrideProvider ?? config.provider;
  const model = overrideModel ?? config.model;
  const envVars = parseEnvVars(config.envVarsString);

  // Write prompt to a temp file to avoid shell escaping issues
  const promptFile = path.join(os.tmpdir(), PROMPT_TEMP_FILE);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const args = buildPiArgs({ ...config, provider, model }, promptFile);
  const systemPromptFile = prepareSystemPromptFile(config.customSystemPrompt);

  try {
    core.info(`Running: pi ${args.join(' ')}`);

    const env = buildPiEnv(envVars);

    const rawOutput = runCommand(
      ['pi', ...args],
      { timeout: PI_TIMEOUT_MS, stdio: 'inherit' },
      env
    );

    // Log the raw output for visibility in GitHub Actions logs
    core.info(`\nPi raw output:\n${rawOutput}`);

    return rawOutput;
  } finally {
    // Clean up temp files even if an error occurs
    safeRemoveFile(promptFile);
    if (systemPromptFile) {
      safeRemoveFile(systemPromptFile);
    }
  }
}

// ── Constants ─────────────────────────────────────────────

// ── Summarize ─────────────────────────────────────────────
/**
 * Summarizes text for use as a git commit message.
 * Uses a simple heuristic to avoid expensive AI calls.
 * @param text - The text to summarize
 * @param issueNumber - The issue number (used for fallback message)
 * @returns A short summary suitable for a git commit message
 */
export function summarize(text: string, issueNumber: number): string {
  const lines = text.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Use first line if it's short enough and not generic
  if (
    firstLine.length > 0 &&
    firstLine.length <= RECOMMENDED_COMMIT_SUBJECT_LENGTH &&
    !GENERIC_PREFIX_PATTERN.test(firstLine)
  ) {
    return firstLine;
  }

  // For longer or generic first lines, use the first sentence or phrase
  const sentences = text.split(/[.!?\n]/);
  const firstSentence = (sentences[0] ?? '')
    .trim()
    .replace(GENERIC_PREFIX_PATTERN, '')
    .substring(0, MAX_COMMIT_SUBJECT_LENGTH)
    .trim();

  return firstSentence.length > 5 ? firstSentence : `Fix issue #${issueNumber}`;
}
