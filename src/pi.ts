import * as core from '@actions/core';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { parseEnvVars } from './utils.js';
import { PI_TIMEOUT_MS } from './constants.js';

// ── Run Pi Agent ───────────────────────────────────────────
/**
 * Runs the pi agent with the given prompt.
 * @param prompt - The prompt to send to pi
 * @returns The response from pi
 * @throws Error if pi exits with non-zero status
 */
export function runPi(prompt: string): string {
  const provider = core.getInput('provider') || 'anthropic';
  const model = core.getInput('model') || 'claude-sonnet-4-5';
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

  if (customSystemPrompt) {
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
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: PI_TIMEOUT_MS,
    env,
  });

  // Clean up
  try {
    fs.unlinkSync(promptFile);
  } catch (e) {
    core.debug(`Failed to clean up prompt temp file: ${e}`);
  }
  if (customSystemPrompt) {
    try {
      fs.unlinkSync('SYSTEM.md');
    } catch (e) {
      core.debug(`Failed to clean up SYSTEM.md: ${e}`);
    }
  }

  if (result.status !== 0) {
    const errMsg =
      result.stderr || (result.error as Error)?.message || 'pi exited with non-zero status';
    throw new Error(`pi agent failed:\n${errMsg}`);
  }

  return (result.stdout || '').trim();
}

// ── Summarize ─────────────────────────────────────────────
/**
 * Summarizes text for use as a git commit message.
 * @param text - The text to summarize
 * @param issueNumber - The issue number (used for fallback message)
 * @returns A short summary suitable for a git commit message
 */
export function summarize(text: string, issueNumber: number): string {
  // Use pi to generate a short commit summary
  const summaryPrompt = `Summarize the following in less than 40 characters, suitable for a git commit message:\n\n${text}`;
  try {
    return runPi(summaryPrompt);
  } catch {
    return `Fix issue #${issueNumber}`;
  }
}
