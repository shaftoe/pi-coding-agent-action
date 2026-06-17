/**
 * @file Tests for the §9 config loader.
 *
 * Covers the JSONC stripper's correctness (the load-bearing case: `//` inside a
 * URL must NOT truncate `forgejo_url`), the default fallback, project-over-global
 * merge, and the project-trust gate. Uses an injected `readFile` so no real FS
 * is touched.
 */

import { describe, it, expect } from 'bun:test';
import { DEFAULT_CONFIG, loadBridgeConfig, stripJsonc, type BridgeConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// stripJsonc
// ---------------------------------------------------------------------------

describe('stripJsonc', () => {
  it('passes through plain JSON unchanged', () => {
    expect(stripJsonc('{"a":1}')).toBe('{"a":1}');
  });

  it('strips line comments', () => {
    expect(stripJsonc('{\n"a": 1 // trailing\n}')).toBe('{\n"a": 1 \n}');
  });

  it('strips block comments (multi-line)', () => {
    expect(stripJsonc('{\n/* hello\nworld */\n"a": 1\n}')).toBe('{\n\n"a": 1\n}');
  });

  it('preserves // inside double-quoted strings (the URL-corruption guard)', () => {
    // The exact failure §9 warns about: a naive //.* regex would truncate this
    // to "https:".
    const input = '{ "forgejo_url": "https://forge.example" }';
    expect(stripJsonc(input)).toBe(input);
    expect(JSON.parse(stripJsonc(input)).forgejo_url).toBe('https://forge.example');
  });

  it('preserves /* inside strings', () => {
    const input = '{ "x": "a/*b*/c" }';
    expect(JSON.parse(stripJsonc(input)).x).toBe('a/*b*/c');
  });

  it('preserves escaped quotes inside strings', () => {
    const input = '{ "x": "say \\"hi\\" // not a comment" }';
    expect(JSON.parse(stripJsonc(input)).x).toBe('say "hi" // not a comment');
  });

  it('handles a realistic JSONC config with comments + a URL', () => {
    const input = `{
  // platform override
  "platform": "forgejo",
  "forgejo_url": "https://forge.example", // self-hosted
  /* disable auto-injection */
  "auto_sync": false
}`;
    expect(JSON.parse(stripJsonc(input))).toEqual({
      platform: 'forgejo',
      forgejo_url: 'https://forge.example',
      auto_sync: false,
    });
  });
});

// ---------------------------------------------------------------------------
// loadBridgeConfig
// ---------------------------------------------------------------------------

/** Build a readFile stub from a map of path → contents. */
function filesFrom(map: Record<string, string>): (p: string) => string | undefined {
  return (p: string) => map[p];
}

describe('loadBridgeConfig', () => {
  it('returns defaults when neither file exists', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: () => undefined,
    });
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.auto_sync).toBe(true);
    expect(cfg.platform).toBe('auto');
  });

  it('reads the global file', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: false,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({ '/g': '{ "auto_sync": false }' }),
    });
    expect(cfg.auto_sync).toBe(false);
  });

  it('project overrides global (per-key merge)', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({
        '/g': '{ "platform": "github", "auto_sync": false }',
        '/p': '{ "auto_sync": true }',
      }),
    });
    expect(cfg.platform).toBe('github'); // from global (not overridden)
    expect(cfg.auto_sync).toBe(true); // from project (overridden)
  });

  it('ignores the project file when not trusted (§9 gate)', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: false,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({
        '/g': '{ "auto_sync": true }',
        '/p': '{ "auto_sync": false }', // must be ignored — untrusted
      }),
    });
    expect(cfg.auto_sync).toBe(true);
  });

  it('parses JSONC (comments preserved) from both files', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({
        '/g': '{ "forgejo_url": "https://forge.example" // global\n}',
        '/p': '// project\n{ "platform": "forgejo" }',
      }),
    });
    expect(cfg.forgejo_url).toBe('https://forge.example');
    expect(cfg.platform).toBe('forgejo');
  });

  it('falls back to defaults on malformed JSONC (best-effort, never fatal)', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({ '/g': '{ not valid json' }),
    });
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('coerces an invalid platform back to "auto" and drops unknown keys', () => {
    const cfg = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({ '/g': '{ "platform": "gitlab", "bogus": true }' }),
    });
    expect(cfg.platform).toBe('auto');
    expect((cfg as unknown as Record<string, unknown>)['bogus']).toBeUndefined();
  });

  it('uses default paths when none are provided', () => {
    // Smoke-test the default path helpers resolve under the agent dir / cwd.
    // We can't easily assert the exact agent dir (env-dependent), but we can
    // confirm the loader consults the default project path under cwd.
    const cfg = loadBridgeConfig({
      cwd: '/my/repo',
      isTrusted: true,
      readFile: (p: string) =>
        p === '/my/repo/.pi/pi-action-bridge.json' ? '{ "auto_sync": false }' : undefined,
    });
    expect(cfg.auto_sync).toBe(false);
  });

  it('keeps an explicit empty-string forgejo_url (?? not ||)', () => {
    // Confirm nullish-coalescing merge: explicit "" wins over a set global.
    const cfg: BridgeConfig = loadBridgeConfig({
      cwd: '/repo',
      isTrusted: true,
      globalPath: '/g',
      projectPath: '/p',
      readFile: filesFrom({
        '/g': '{ "forgejo_url": "https://global.example" }',
        '/p': '{ "forgejo_url": "" }',
      }),
    });
    expect(cfg.forgejo_url).toBe('');
  });
});
