/**
 * @file GitHub Actions configuration adapter.
 *
 * Extracts configuration from `@actions/core` inputs into a plain
 * `PiConfig` object. This is the GitHub Action frontend's implementation
 * of config gathering; other frontends (CLI, GitHub App) would provide
 * their own implementation.
 */

import * as core from '@actions/core';
import type { PiConfig } from '../types';

/**
 * Parse the `loaded_tools` input.
 *
 * - `'all'`, empty, or whitespace-only → `undefined` (use all tools)
 * - List of tool names (one per line) → `string[]`
 *
 * Whitespace around tool names is trimmed. Empty items after splitting are
 * discarded. Duplicate names are deduplicated.
 */
function parseLoadedTools(input: string): string[] | undefined {
  const trimmed = input?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return undefined;
  }
  const tools = trimmed
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? [...new Set(tools)] : undefined;
}

/**
 * Gather configuration from GitHub Action inputs.
 *
 * Validates that all required inputs are present and throws descriptive
 * errors when they are missing, so users see actionable guidance instead
 * of obscure downstream failures like "Model not found: /".
 *
 * @returns A fully populated PiConfig object.
 */
export function gatherActionsConfig(): PiConfig {
  const provider = core.getInput('provider');
  const model = core.getInput('model');
  const token = core.getInput('token');

  if (!provider) {
    throw new Error(
      'Missing required input: `provider`. ' +
        'Set it to your LLM provider (e.g. "anthropic", "openai", "google"). ' +
        'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.'
    );
  }

  if (!model) {
    throw new Error(
      'Missing required input: `model`. ' +
        'Set it to the desired model (e.g. "claude-sonnet-4-5", "gpt-4o"). ' +
        'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.'
    );
  }

  if (!token) {
    core.debug('[config] No token provided — relying on provider-side auth (e.g. ADC)');
  }

  const extensionsInput = core.getInput('extensions');
  const extensions = extensionsInput
    ? extensionsInput
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    : undefined;

  const loadBuiltinExtensionsInput = core.getInput('load_builtin_extensions');
  const loadBuiltinExtensions = loadBuiltinExtensionsInput
    ? loadBuiltinExtensionsInput.toLowerCase() === 'true'
    : true; // default to true

  const loadedToolsInput = core.getInput('loaded_tools');
  const loadedTools = parseLoadedTools(loadedToolsInput);

  const baseUrl = core.getInput('base_url') || undefined;

  const exportSessionHtmlInput = core.getInput('export_session_html');
  const exportSessionHtml = exportSessionHtmlInput
    ? exportSessionHtmlInput.toLowerCase() === 'true'
    : true; // default to true

  const exportSessionJsonlInput = core.getInput('export_session_jsonl');
  const exportSessionJsonl = exportSessionJsonlInput
    ? exportSessionJsonlInput.toLowerCase() === 'true'
    : false; // default to false

  const autoCompactionInput = core.getInput('auto_compaction');
  const autoCompaction = autoCompactionInput ? autoCompactionInput.toLowerCase() === 'true' : false; // default to false

  const piVersionInput = core.getInput('pi_version');
  const piVersion = piVersionInput?.trim() || undefined;

  const diffMaxLinesInput = core.getInput('diff_max_lines');
  const parsedLines = diffMaxLinesInput ? parseInt(diffMaxLinesInput, 10) : NaN;
  const diffMaxLines = parsedLines > 0 ? parsedLines : undefined;

  const diffMaxBytesInput = core.getInput('diff_max_bytes');
  const parsedBytes = diffMaxBytesInput ? parseInt(diffMaxBytesInput, 10) : NaN;
  const diffMaxBytes = parsedBytes > 0 ? parsedBytes : undefined;

  const diffIgnorePatternsInput = core.getInput('diff_ignore_patterns');
  const diffIgnorePatterns = diffIgnorePatternsInput
    ? diffIgnorePatternsInput.split(/\s+/).filter(Boolean)
    : undefined;

  return {
    provider,
    model,
    token,
    thinkingLevel: core.getInput('thinking_level') ?? 'off',
    promptInput: core.getInput('prompt'),
    ...(extensions?.length ? { extensions } : {}),
    loadBuiltinExtensions,
    ...(loadedTools ? { loadedTools } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    exportSessionHtml,
    exportSessionJsonl,
    autoCompaction,
    ...(diffMaxLines ? { diffMaxLines } : {}),
    ...(diffMaxBytes ? { diffMaxBytes } : {}),
    ...(diffIgnorePatterns?.length ? { diffIgnorePatterns } : {}),
    ...(piVersion ? { piVersion } : {}),
    /**
     * packageDir is intentionally omitted: the SDK is now installed via npm
     * (external mode), so its own getPackageDir() resolves correctly.
     * The field is kept on PiConfig for backward compatibility.
     */
  };
}
