/**
 * @file GitHub Actions configuration adapter.
 *
 * Extracts configuration from `@actions/core` inputs into a plain
 * `PiConfig` object. This is the GitHub Action frontend's implementation
 * of config gathering; other frontends (CLI, GitHub App) would provide
 * their own implementation.
 *
 * Structure:
 *   - Parsing helpers (`parseBooleanInput`, `parsePositiveIntInput`,
 *     `parseStringListInput`, `parseLoadedTools`) — pure functions over
 *     raw string inputs. Exported so they can be unit-tested directly.
 *   - `validateRequiredInputs` — throws descriptive errors when a
 *     required input is missing. Error messages are exported as
 *     constants so the contract is stable for callers (and snapshot tests).
 *   - `gatherActionsConfig` — the entry point. Reads inputs, parses them,
 *     assembles the final `PiConfig`.
 */

import * as core from '@actions/core';
import type { McpServerConfig } from '@earendil-works/pi-coding-agent';
import type { OpengistExpiration, PiConfig } from '@alexanderfortin/pi-orchestrator';
import {
  DEFAULT_OPENGIST_EXPIRATION,
  OPENGIST_EXPIRATIONS,
} from '@alexanderfortin/pi-orchestrator';

/** Valid values for the `cache_warming` input (mirrors the SDK's modes). */
export const CACHE_WARMING_MODES = ['off', 'streaming', 'idle'] as const;

// ---------------------------------------------------------------------------
// Error message constants — keep stable; they are part of the public
// contract documented in `action.yml` and surfaced to users in the
// Actions log.
// ---------------------------------------------------------------------------

export const MISSING_PROVIDER_MESSAGE =
  'Missing required input: `provider`. ' +
  'Set it to your LLM provider (e.g. "anthropic", "openai", "google"). ' +
  'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.';

export const MISSING_MODEL_MESSAGE =
  'Missing required input: `model`. ' +
  'Set it to the desired model (e.g. "claude-sonnet-4-5", "gpt-4o"). ' +
  'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.';

// ---------------------------------------------------------------------------
// Parsing helpers (pure functions)
// ---------------------------------------------------------------------------

/**
 * Parse a yes/no string into a boolean. Returns `defaultValue` when the
 * input is empty. Only the literal string `'true'` (case-insensitive)
 * maps to `true`; any other non-empty value maps to `false`.
 */
export function parseBooleanInput(raw: string, defaultValue: boolean): boolean {
  return raw ? raw.toLowerCase() === 'true' : defaultValue;
}

/**
 * Parse a string into a positive integer. Returns `undefined` when the
 * input is empty, non-numeric, or ≤ 0.
 */
export function parsePositiveIntInput(raw: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = parseInt(raw, 10);
  return parsed > 0 ? parsed : undefined;
}

/**
 * Split a string into a trimmed, deduped list of non-empty items using
 * `separator`. Returns `undefined` when the input is empty or contains
 * only whitespace.
 *
 * @example
 *   parseStringListInput('a\nb\nc', '\n')           // ['a', 'b', 'c']
 *   parseStringListInput('a b  c', /\s+/)           // ['a', 'b', 'c']
 *   parseStringListInput('', '\n')                  // undefined
 */
export function parseStringListInput(
  raw: string,
  separator: string | RegExp
): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const items = raw
    .split(separator)
    .map(s => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Parse the `loaded_tools` input.
 *
 * - `'all'`, empty, or whitespace-only → `undefined` (use all tools)
 * - List of tool names (one per line) → `string[]`
 *
 * Whitespace around tool names is trimmed. Empty items after splitting are
 * discarded. Duplicate names are deduplicated.
 */
export function parseLoadedTools(input: string): string[] | undefined {
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
 * Parse the `share_gist_expiration` input into an Opengist TTL preset.
 *
 * Returns `undefined` for empty input (the provider then applies its 7-day
 * default) and for unrecognised values (a warning is emitted by the caller so
 * a typo doesn't silently change the TTL). Matching is case-insensitive and
 * whitespace-trimmed.
 */
export function parseGistExpiration(raw: string): OpengistExpiration | undefined {
  const normalized = raw.trim().toLowerCase();
  return (OPENGIST_EXPIRATIONS as readonly string[]).includes(normalized)
    ? (normalized as OpengistExpiration)
    : undefined;
}

/**
 * Parse the `cache_warming` input into a prompt cache-warming mode.
 *
 * Returns `undefined` for empty input (the SDK then applies its default,
 * `"streaming"`) and for unrecognised values (a warning is emitted by the
 * caller so a typo doesn't silently change behavior). Case-insensitive.
 */
export function parseCacheWarmingMode(raw: string): PiConfig['cacheWarming'] {
  const normalized = raw.trim().toLowerCase();
  return (CACHE_WARMING_MODES as readonly string[]).includes(normalized)
    ? (normalized as PiConfig['cacheWarming'])
    : undefined;
}

/** Parsed result of the `mcp_servers` input. */
export interface ParsedMcpServers {
  /** Server configs keyed by name. */
  servers: Record<string, McpServerConfig>;
  /** Whether `codemode`-exposure servers auto-activate codemode. */
  autoEnableCodemode?: boolean;
}

/** True when `value` is a non-null, non-array JSON object. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse the raw input as a JSON object or throw a descriptive error. */
function parseMcpJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // `JSON.parse` only throws `SyntaxError`; `String()` still renders it with
    // its message while keeping coverage branch-free.
    throw new Error(`Invalid \`mcp_servers\` JSON: ${String(error)}`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error('Invalid `mcp_servers`: expected a JSON object.');
  }
  return parsed;
}

/**
 * Resolve the servers map from either the bare map or the `mcp.json` shape,
 * reporting which shape was used (to read `autoEnableCodemode` only when wrapped).
 */
function extractMcpServers(root: Record<string, unknown>): {
  rawServers: Record<string, unknown>;
  wrapped: boolean;
} {
  // A bare map is already a validated JSON object, so only the wrapped shape
  // can fail here.
  if (!Object.prototype.hasOwnProperty.call(root, 'mcpServers')) {
    return { rawServers: root, wrapped: false };
  }
  const rawServers = root.mcpServers;
  if (!isJsonObject(rawServers)) {
    throw new Error('Invalid `mcp_servers`: `mcpServers` must be a JSON object.');
  }
  return { rawServers, wrapped: true };
}

/** Validate one server entry selects exactly one transport (`command` or `url`). */
function assertMcpServerEntry(name: string, config: unknown): void {
  if (!isJsonObject(config)) {
    throw new Error(`Invalid MCP server "${name}": expected a JSON object.`);
  }
  const hasCommand = typeof config.command === 'string';
  const hasUrl = typeof config.url === 'string';
  if (hasCommand && hasUrl) {
    throw new Error(
      `Invalid MCP server "${name}": both "command" and "url" set — pick one transport.`
    );
  }
  if (!hasCommand && !hasUrl) {
    throw new Error(
      `Invalid MCP server "${name}": expected a "command" (stdio) or "url" (HTTP) field.`
    );
  }
}

/**
 * Parse the `mcp_servers` input.
 *
 * Accepts either the bare servers map (`{"<name>": {...}}`) or the full
 * `mcp.json` shape (`{"mcpServers": {...}, "autoEnableCodemode": true}`).
 * Throws a descriptive error on malformed JSON or entries that are neither a
 * stdio (`command`) nor an HTTP (`url`) server, so a typo fails fast instead of
 * silently connecting nothing.
 *
 * Shape validation is intentionally shallow: the SDK validates the detailed
 * per-transport fields when the server connects and reports those errors at
 * startup.
 */
export function parseMcpServers(raw: string): ParsedMcpServers | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  const root = parseMcpJson(trimmed);
  const { rawServers, wrapped } = extractMcpServers(root);

  for (const [name, config] of Object.entries(rawServers)) {
    assertMcpServerEntry(name, config);
  }

  const autoEnableCodemode = wrapped ? root.autoEnableCodemode : undefined;
  if (autoEnableCodemode !== undefined && typeof autoEnableCodemode !== 'boolean') {
    throw new Error('Invalid `mcp_servers`: `autoEnableCodemode` must be a boolean.');
  }

  return {
    servers: rawServers as Record<string, McpServerConfig>,
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
  };
}

/**
 * Register credential-bearing MCP fields as log secrets.
 *
 * HTTP `headers` and stdio `env` values commonly hold tokens, as does an OAuth
 * client secret. Literal values are masked; pure `${NAME}` environment
 * references are skipped because the input line itself carries no secret (the
 * referenced variable is masked by the runner when it comes from `secrets`).
 */
function maskMcpSecrets(servers: Record<string, McpServerConfig>): void {
  for (const config of Object.values(servers)) {
    const { headers, env, oauth } = config as {
      headers?: Record<string, string>;
      env?: Record<string, string>;
      oauth?: { clientSecret?: string };
    };
    for (const value of [...Object.values(headers ?? {}), ...Object.values(env ?? {})]) {
      if (value && !/^\$\{[^}]+\}$/.test(value)) {
        core.setSecret(value);
      }
    }
    if (oauth?.clientSecret) {
      core.setSecret(oauth.clientSecret);
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Throw descriptive errors for missing required inputs. Preserves exact
 * message text — these strings are part of the public contract.
 *
 * Exported so error messages can be asserted against without exercising
 * the full config-gathering pipeline.
 */
export function validateRequiredInputs(provider: string, model: string): void {
  if (!provider) {
    throw new Error(MISSING_PROVIDER_MESSAGE);
  }
  if (!model) {
    throw new Error(MISSING_MODEL_MESSAGE);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Gather configuration from GitHub Action inputs.
 *
 * Validates that all required inputs are present and throws descriptive
 * errors when they are missing, so users see actionable guidance instead
 * of obscure downstream failures like "Model not found: /".
 *
 * @returns A fully populated PiConfig object.
 */
// fallow-ignore-next-line complexity
export function gatherActionsConfig(): PiConfig {
  // --- Required inputs ----------------------------------------------------
  const provider = core.getInput('provider');
  const model = core.getInput('model');
  const token = core.getInput('token');

  validateRequiredInputs(provider, model);

  if (!token) {
    core.debug('[config] No token provided — relying on provider-side auth (e.g. ADC)');
  }

  // --- Optional string inputs --------------------------------------------
  const promptInput = core.getInput('prompt');
  const thinkingLevel = core.getInput('thinking_level') ?? 'off';
  const baseUrl = core.getInput('base_url') || undefined;

  // --- Optional list inputs ----------------------------------------------
  const extensions = parseStringListInput(core.getInput('extensions'), '\n');
  const diffIgnorePatterns = parseStringListInput(core.getInput('diff_ignore_patterns'), /\s+/);
  const loadedTools = parseLoadedTools(core.getInput('loaded_tools'));

  // --- Optional boolean inputs -------------------------------------------
  const loadBuiltinExtensions = parseBooleanInput(core.getInput('load_builtin_extensions'), true);
  const enableCodemode = parseBooleanInput(core.getInput('enable_codemode'), false);
  const enableToolSearch = parseBooleanInput(core.getInput('enable_tool_search'), false);
  const mcp = parseMcpServers(core.getInput('mcp_servers'));
  if (mcp) {
    maskMcpSecrets(mcp.servers);
  }
  const exportSessionHtml = parseBooleanInput(core.getInput('export_session_html'), true);
  const exportSessionJsonl = parseBooleanInput(core.getInput('export_session_jsonl'), false);
  const autoCompaction = parseBooleanInput(core.getInput('auto_compaction'), false);
  const shareSession = parseBooleanInput(core.getInput('share_session'), false);
  const refreshModelCatalog = parseBooleanInput(core.getInput('refresh_model_catalog'), true);

  // --- Prompt cache warming -----------------------------------------------
  const cacheWarmingRaw = core.getInput('cache_warming');
  const cacheWarming = parseCacheWarmingMode(cacheWarmingRaw);
  if (cacheWarmingRaw.trim() && !cacheWarming) {
    core.warning(
      `Unknown cache_warming "${cacheWarmingRaw.trim()}". ` +
        `Valid values are: ${CACHE_WARMING_MODES.join(', ')}. ` +
        'Falling back to the SDK default ("streaming").'
    );
  }

  // --- Session sharing storage backend inputs ---------------------------
  const shareGistProviderRaw = core.getInput('share_gist_provider').trim().toLowerCase();
  const shareGistProvider =
    shareGistProviderRaw === 'opengist'
      ? 'opengist'
      : shareGistProviderRaw === 'github'
        ? 'github'
        : undefined;
  // An unknown value (typo, or a backend we don't support yet) silently
  // collapses to the github default. Warn so a misconfigured provider is
  // visible instead of quietly creating a GitHub gist with ignored Opengist
  // config.
  if (shareGistProviderRaw && !shareGistProvider) {
    core.warning(
      `Unknown share_gist_provider "${shareGistProviderRaw}"; falling back to github. ` +
        'Valid values are "github" and "opengist".'
    );
  }
  const shareGistApiUrl = core.getInput('share_gist_api_url').trim() || undefined;
  const shareGistToken = core.getInput('share_gist_token').trim() || undefined;
  if (shareGistToken) {
    core.setSecret(shareGistToken);
  }
  // TTL preset for shared Opengist gists. Unset → undefined so the provider's
  // 7-day default applies; an unrecognised value warns and also falls back to
  // that default rather than sending a value the server would reject.
  const shareGistExpirationRaw = core.getInput('share_gist_expiration');
  const shareGistExpiration = parseGistExpiration(shareGistExpirationRaw);
  if (shareGistExpirationRaw.trim() && !shareGistExpiration) {
    core.warning(
      `Unknown share_gist_expiration "${shareGistExpirationRaw.trim()}"; ` +
        `defaulting to ${DEFAULT_OPENGIST_EXPIRATION}. ` +
        `Valid values are: ${OPENGIST_EXPIRATIONS.join(', ')}.`
    );
  }

  // --- Optional positive-integer inputs ----------------------------------
  const diffMaxLines = parsePositiveIntInput(core.getInput('diff_max_lines'));
  const diffMaxBytes = parsePositiveIntInput(core.getInput('diff_max_bytes'));
  const prNumber = parsePositiveIntInput(core.getInput('pr_number'));

  // --- Session sharing inputs --------------------------------------------
  const githubToken = core.getInput('github_token') || undefined;
  // Register the token for log masking — it may be a PAT/App token with
  // elevated scopes (e.g. gist) that should never appear in clear text.
  if (githubToken) {
    core.setSecret(githubToken);
  }

  // --- Assemble PiConfig (only include optional keys when set) -----------
  return {
    provider,
    model,
    token,
    thinkingLevel,
    promptInput,
    ...(extensions?.length ? { extensions } : {}),
    loadBuiltinExtensions,
    ...(loadedTools ? { loadedTools } : {}),
    ...(enableCodemode ? { enableCodemode } : {}),
    ...(enableToolSearch ? { enableToolSearch } : {}),
    ...(mcp ? { mcpServers: mcp.servers } : {}),
    ...(mcp?.autoEnableCodemode === undefined
      ? {}
      : { mcpAutoEnableCodemode: mcp.autoEnableCodemode }),
    ...(baseUrl ? { baseUrl } : {}),
    exportSessionHtml,
    exportSessionJsonl,
    autoCompaction,
    ...(cacheWarming ? { cacheWarming } : {}),
    refreshModelCatalog,
    shareSession,
    ...(shareGistProvider ? { shareGistProvider } : {}),
    ...(shareGistApiUrl ? { shareGistApiUrl } : {}),
    ...(shareGistToken ? { shareGistToken } : {}),
    ...(shareGistExpiration ? { shareGistExpiration } : {}),
    ...(githubToken ? { githubToken } : {}),
    ...(diffMaxLines ? { diffMaxLines } : {}),
    ...(diffMaxBytes ? { diffMaxBytes } : {}),
    ...(diffIgnorePatterns?.length ? { diffIgnorePatterns } : {}),
    ...(prNumber ? { prNumber } : {}),
  };
}
