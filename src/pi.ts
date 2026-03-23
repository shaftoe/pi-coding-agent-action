import * as core from '@actions/core';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { parseEnvVars } from './utils.js';
import { PI_TIMEOUT_MS } from './constants.js';

// ── Helpers ──────────────────────────────────────────────────
/**
 * Safely removes a file if it exists, logging any errors as debug messages.
 * @param filePath - The path to the file to remove
 */
function safeRemoveFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    core.debug(`Failed to clean up file ${filePath}: ${e}`);
  }
}

// ── Run Pi Agent ───────────────────────────────────────────
/**
 * Runs the pi agent with the given prompt.
 * @param prompt - The prompt to send to pi
 * @param overrideProvider - Optional provider override (for internal calls)
 * @param overrideModel - Optional model override (for internal calls)
 * @returns The response from pi
 * @throws Error if pi exits with non-zero status
 */
export function runPi(prompt: string, overrideProvider?: string, overrideModel?: string): string {
  const provider = (overrideProvider ?? core.getInput('provider')) || 'anthropic';
  const model = (overrideModel ?? core.getInput('model')) || 'claude-sonnet-4-5';
  const extraTools = core.getInput('extra_tools') || '';
  const customSystemPrompt = core.getInput('prompt') || '';
  const envVarsString = core.getInput('env_vars') || '';
  const envVars = parseEnvVars(envVarsString);

  // Write prompt to a temp file to avoid shell escaping issues
  const promptFile = path.join(os.tmpdir(), 'pi_prompt.md');
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const args = [
    '--provider',
    provider,
    '--model',
    model,
    '-p', // print / non-interactive mode
    `@${promptFile}`,
  ];

  if (extraTools) {
    args.push('--tools', extraTools);
  }

  const hasCustomSystemPrompt = Boolean(customSystemPrompt);
  if (hasCustomSystemPrompt) {
    // Write SYSTEM.md to current directory so pi picks it up
    fs.writeFileSync('SYSTEM.md', customSystemPrompt, 'utf8');
  }

  core.info(`Running: pi ${args.join(' ')}`);

  // Inject custom environment variables
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { key, value } of envVars) {
    core.info(`Setting env var: ${key}=***`);
    env[key] = value;
  }

  const result = spawnSync('pi', args, {
    stdio: ['pipe', 'pipe', 'inherit'], // Pipe stdout to capture, inherit stderr for visibility
    encoding: 'utf8',
    timeout: PI_TIMEOUT_MS,
    env,
  });

  // Clean up temp files
  safeRemoveFile(promptFile);
  if (hasCustomSystemPrompt) {
    safeRemoveFile('SYSTEM.md');
  }

  if (result.status !== 0) {
    const errMsg =
      result.stderr || (result.error as Error)?.message || 'pi exited with non-zero status';
    throw new Error(`pi agent failed:\n${errMsg}`);
  }

  const output = (result.stdout || '').trim();

  // Log the output for visibility in GitHub Actions logs
  core.info(`Pi output:\n${output}`);

  return output;
}

// ── Summarize ─────────────────────────────────────────────
/**
 * Summarizes text for use as a git commit message.
 * Uses a simple heuristic to avoid expensive AI calls.
 * @param text - The text to summarize
 * @param issueNumber - The issue number (used for fallback message)
 * @returns A short summary suitable for a git commit message
 */
export function summarize(text: string, issueNumber: number): string {
  const firstLine = text.split('\n')[0].trim();
  const genericPattern = /^(I|I'll|Sure|OK|Great|Here|The|This|A)/i;

  // Use first line if it's short enough and not generic
  if (firstLine.length > 0 && firstLine.length <= 50 && !genericPattern.test(firstLine)) {
    return firstLine;
  }

  // For longer or generic first lines, use the first sentence or phrase
  const firstSentence = text
    .split(/[.!?\n]/)[0]
    .trim()
    .replace(genericPattern, '')
    .substring(0, 50)
    .trim();

  return firstSentence.length > 5 ? firstSentence : `Fix issue #${issueNumber}`;
}
