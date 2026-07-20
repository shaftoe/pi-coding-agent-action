/**
 * @file Integration tests for {@link runCommand} (the `pi-cli run` wiring).
 *
 * `runCommand` chains argv → token resolution → Octokit + platform provider
 * → orchestrator. Its observable wiring is tested here by mocking the two
 * side-effectful boundaries:
 *
 *   - `createCliPiAgent` (would invoke the LLM SDK) → a fake agent that
 *     resolves immediately with a fixed result.
 *   - `createCliOctokit` (constructs a real Octokit) → a spy that records its
 *     arguments and returns a stub octokit.
 *
 * The CLI's sentinel platform context (`issue.number: 0`, empty payload,
 * `'cli'` event name) makes the provider's reaction/comment methods no-op, so
 * the stub octokit is never actually called. This lets us assert the pure
 * wiring — in particular that the resolved `--platform` value is threaded to
 * **both** the Octokit API base URL (`createCliOctokit`) **and** the platform
 * provider (footer URL format) — without any network or LLM calls.
 *
 * `runCommand`'s end-to-end execution is what gives the platform-threading
 * lines in `run.ts` their coverage; the unit behaviour of `createCliOctokit`
 * and `parsePlatformType` is covered in their own spec files.
 */

import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — registered before any import of run.ts so its bindings pick
// up the replacements. (Vitest resolves vi.mock against the absolute path of
// the specifier, so the path here is relative to *this* test file.)
// ---------------------------------------------------------------------------

/** A recorded `createCliOctokit(token, serverUrl, platformType)` invocation. */
interface CapturedOctokitCall {
  token: string;
  serverUrl: string;
  platformType: string | undefined;
}

/**
 * Captures every `createCliOctokit(token, serverUrl, platformType)` invocation
 * so tests can assert the resolved `--platform` reaches the API-base-URL path.
 */
const octokitCalls: CapturedOctokitCall[] = [];

// The CLI context never exercises octokit REST methods (reactions + comments
// no-op for the 'cli' sentinel context), so an empty object is a safe stand-in.
const stubOctokit = {};

/**
 * The single `createCliOctokit` call recorded for the current `runCommand`.
 *
 * `noUncheckedIndexedAccess` types `octokitCalls[0]` as possibly undefined;
 * each `runCommand` issues exactly one call, so this both asserts that and
 * returns a non-nullable reference for chained assertions.
 */
function singleOctokitCall(): CapturedOctokitCall {
  expect(octokitCalls).toHaveLength(1);
  return octokitCalls[0]!;
}

vi.mock('../../src/octokit.js', () => ({
  createCliOctokit: (token: string, serverUrl: string, platformType?: string) => {
    octokitCalls.push({ token, serverUrl, platformType });
    return stubOctokit;
  },
}));

/**
 * Most-recent platform-provider `type` handed to the Pi agent factory, so tests
 * can assert the resolved `--platform` also reaches the provider (footer URL).
 */
let lastProviderType: string | undefined;

const fakeRun = vi.fn(() =>
  Promise.resolve({ result: 'CLI agent finished', sessionStats: undefined, error: undefined })
);

vi.mock('../../src/adapters/pi-agent.js', () => ({
  createCliPiAgent: (_config: unknown, _logger: unknown, provider: { type?: string }) => {
    lastProviderType = provider.type;
    return {
      run: () => fakeRun(),
      getSessionStats: () => undefined,
      exportSessionHtml: () => Promise.resolve(''),
      exportSessionJsonl: () => Promise.resolve(''),
    };
  },
}));

// Import after the mocks above are registered.
const { runCommand } = await import('../../src/commands/run.js');
import type { RunCommandArgs } from '../../src/commands/run.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeArgs(overrides: Partial<RunCommandArgs> = {}): RunCommandArgs {
  return {
    prompt: 'say hello',
    repo: 'shaftoe/pi-coding-agent-action',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cwd: '/tmp/pi-cli-test',
    serverUrl: 'https://forge.l3x.in',
    platform: 'forgejo',
    verbose: false,
    quiet: false,
    ...overrides,
  };
}

const ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'ANTHROPIC_API_KEY'] as const;
let savedEnv: Record<string, string | undefined> = {};
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.GITHUB_TOKEN = 'ghp-test';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  delete process.env.GH_TOKEN;
  savedExitCode = process.exitCode;
  process.exitCode = 0;

  octokitCalls.length = 0;
  lastProviderType = undefined;
  fakeRun.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  process.exitCode = savedExitCode;
});

// ---------------------------------------------------------------------------
// --platform threading (the behaviour this PR adds)
// ---------------------------------------------------------------------------

describe('runCommand — --platform threading', () => {
  test('threads forgejo into both the API base URL and the provider', async () => {
    // forge.l3x.in has no forgejo/codeberg/gitea hostname indicator, so the
    // explicit --platform is what makes API calls hit /api/v1 (not /api/v3).
    await runCommand(makeArgs({ platform: 'forgejo' }));

    // API base-URL path (createCliOctokit)
    const call = singleOctokitCall();
    expect(call.serverUrl).toBe('https://forge.l3x.in');
    expect(call.platformType).toBe('forgejo');
    // Provider path (footer URL format)
    expect(lastProviderType).toBe('forgejo');
    // The (fake) agent ran exactly once → the orchestrator completed.
    expect(fakeRun).toHaveBeenCalledTimes(1);
  });

  test('threads codeberg into both the API base URL and the provider', async () => {
    await runCommand(makeArgs({ platform: 'codeberg' }));
    expect(singleOctokitCall().platformType).toBe('codeberg');
    expect(lastProviderType).toBe('codeberg');
  });

  test('resolves the gitea alias to forgejo end-to-end', async () => {
    // parsePlatformType('gitea') → 'forgejo'; the CLI threads that resolved
    // value, so API calls hit /api/v1 and the footer uses the Forgejo format.
    await runCommand(makeArgs({ platform: 'gitea' }));
    expect(singleOctokitCall().platformType).toBe('forgejo');
    expect(lastProviderType).toBe('forgejo');
  });

  test('threads github into both paths (hostname matching)', async () => {
    await runCommand(makeArgs({ platform: 'github', serverUrl: 'https://github.com' }));
    const call = singleOctokitCall();
    expect(call.serverUrl).toBe('https://github.com');
    expect(call.platformType).toBe('github');
    expect(lastProviderType).toBe('github');
  });

  test('defaults to github when --platform is empty', async () => {
    await runCommand(makeArgs({ platform: '' }));
    expect(singleOctokitCall().platformType).toBe('github');
    expect(lastProviderType).toBe('github');
  });

  test('warns and falls back to github for an unknown --platform value', async () => {
    // An unrecognized value invokes the onUnknown callback (logger.warning)
    // inside runCommand's parsePlatformType call, then falls back to 'github'
    // so a typo never hard-fails the run.
    await runCommand(makeArgs({ platform: 'gitlab' }));
    expect(singleOctokitCall().platformType).toBe('github');
    expect(lastProviderType).toBe('github');
  });
});

// ---------------------------------------------------------------------------
// Setup errors short-circuit before the platform is even resolved
// ---------------------------------------------------------------------------

describe('runCommand — setup errors short-circuit before platform resolution', () => {
  test('throws for an unknown --provider', async () => {
    await expect(runCommand(makeArgs({ provider: 'nope' }))).rejects.toThrow(/Unknown provider/);
    // createCliOctokit must not have run on a setup error.
    expect(octokitCalls).toHaveLength(0);
  });

  test('throws for a malformed --repo', async () => {
    await expect(runCommand(makeArgs({ repo: 'not-a-slug' }))).rejects.toThrow(/Expected format/);
    expect(octokitCalls).toHaveLength(0);
  });
});
