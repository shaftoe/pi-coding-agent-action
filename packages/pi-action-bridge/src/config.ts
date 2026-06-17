/**
 * @file Extension config (§9).
 *
 * The bridge owns its own JSONC config files — never a slice of Pi's reserved
 * `settings.json` (Pi owns that schema; there's no settings accessor on
 * `ExtensionContext` to read it safely). Two scopes, mirroring Pi's own model:
 *
 *   - Global  — `~/.pi/agent/pi-action-bridge.json`           (always read)
 *   - Project — `<cwd>/.pi/pi-action-bridge.json`             (only when trusted)
 *
 * Project overrides global (shallow per-key); both are JSONC. The one consumer
 * today is `auto_sync` (gates Phase 4 enrichment); `platform` / `forgejo_url`
 * are carried for later phases so the file format is stable up front.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Recognised platform selectors. `auto` derives from the git remote. */
export type BridgePlatform = 'auto' | 'github' | 'codeberg' | 'forgejo';

/** Resolved bridge config (all fields always present after loading). */
export interface BridgeConfig {
  platform: BridgePlatform;
  /** Required when `platform === 'forgejo'` (consumed in a later phase). */
  forgejo_url: string;
  /** Auto-inject PR context on the first turn (Phase 4 / §6). */
  auto_sync: boolean;
}

/** Defaults applied when a field is absent (§9 example). */
export const DEFAULT_CONFIG: BridgeConfig = {
  platform: 'auto',
  forgejo_url: '',
  auto_sync: true,
};

/** Global config path: `<agentDir>/pi-action-bridge.json`. */
export function defaultGlobalConfigPath(): string {
  return join(getAgentDir(), 'pi-action-bridge.json');
}

/** Project config path: `<cwd>/.pi/pi-action-bridge.json`. */
export function defaultProjectConfigPath(cwd: string): string {
  return join(cwd, '.pi', 'pi-action-bridge.json');
}

/**
 * Strip JSONC line (`//`) and block (`/* * /`) comments while preserving their
 * contents inside string literals. A naive `//.*` regex corrupts URLs — a
 * `forgejo_url: "https://forge.example"` value is truncated at the first `//`
 * — which is exactly the failure §9 warns against. Small, dependency-free, and
 * unit-tested (see `tests/config.spec.ts`); swap for `strip-json-comments` if
 * §9 ever demands more.
 */
export function stripJsonc(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    // String literal — copy verbatim until the matching unescaped quote so
    // `//` / `/*` inside it (e.g. in a URL) are preserved.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = input[i];
        out += c;
        if (c === '\\' && i + 1 < n) {
          // Escaped char — copy it and the char it escapes, then advance.
          out += input[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (c === quote) {
          break;
        }
      }
      continue;
    }

    // Line comment — skip to end of line (keep the newline for line numbers).
    if (ch === '/' && input[i + 1] === '/') {
      i += 2;
      while (i < n && input[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Block comment — skip to the closing `*/`.
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) {
        i++;
      }
      i += 2; // consume the closing */
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Read a file's contents, returning `undefined` when it's missing/unreadable. */
function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Parse one config file's raw JSONC text into a *partial* config. Returns `{}`
 * on missing/empty/malformed input — config is best-effort, never fatal.
 */
function parseConfigFile(raw: string | undefined): Partial<BridgeConfig> {
  if (!raw || raw.trim() === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch {
    return {}; // malformed JSONC → silently fall back (documented best-effort)
  }
  return coerceConfig(parsed);
}

/** Keep only recognised keys with the right type; drop the rest. */
function coerceConfig(raw: unknown): Partial<BridgeConfig> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const out: Partial<BridgeConfig> = {};

  const platform = o['platform'];
  if (
    platform === 'auto' ||
    platform === 'github' ||
    platform === 'codeberg' ||
    platform === 'forgejo'
  ) {
    out.platform = platform;
  } else if (platform !== undefined) {
    out.platform = 'auto'; // invalid → default
  }

  if (typeof o['forgejo_url'] === 'string') {
    out.forgejo_url = o['forgejo_url'];
  }
  if (typeof o['auto_sync'] === 'boolean') {
    out.auto_sync = o['auto_sync'];
  }

  return out;
}

/** Shallow per-key merge; `over` wins for any key it defines. */
function mergeConfig(base: BridgeConfig, over: Partial<BridgeConfig>): BridgeConfig {
  return {
    platform: over.platform ?? base.platform,
    forgejo_url: over.forgejo_url ?? base.forgejo_url,
    auto_sync: over.auto_sync ?? base.auto_sync,
  };
}

/** Args for {@link loadBridgeConfig}; every field is injectable for tests. */
export interface LoadConfigArgs {
  /** Current working directory (resolves the project path + trust scope). */
  cwd: string;
  /** Whether project-local trust is active (gates the project file, §9). */
  isTrusted: boolean;
  /** Override the global path (default: {@link defaultGlobalConfigPath}). */
  globalPath?: string;
  /** Override the project path (default: {@link defaultProjectConfigPath}). */
  projectPath?: string;
  /** Override file reading (default: {@link readOptional}). */
  readFile?: (path: string) => string | undefined;
}

/**
 * Load + merge the bridge config. Global is always read; project is read only
 * when `isTrusted` (mirrors Pi's gate for `.pi/settings.json`). Missing files
 * and malformed JSONC fall back to {@link DEFAULT_CONFIG}.
 */
export function loadBridgeConfig(args: LoadConfigArgs): BridgeConfig {
  const readFile = args.readFile ?? readOptional;
  const globalPath = args.globalPath ?? defaultGlobalConfigPath();
  const projectPath = args.projectPath ?? defaultProjectConfigPath(args.cwd);

  const global = parseConfigFile(readFile(globalPath));
  const project = args.isTrusted ? parseConfigFile(readFile(projectPath)) : {};

  return mergeConfig(mergeConfig(DEFAULT_CONFIG, global), project);
}
