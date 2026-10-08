/**
 * @file Thin `simple-git` wrappers used by the detection core.
 *
 * Isolates the rest of the tool from the `simple-git` API surface so the core
 * can be driven by a fake {@link GitInspector} in tests.
 *
 * Git-config isolation: in sandboxed agents where the user's `~/.gitconfig`
 * is unreadable (`fatal: unable to access '~/.gitconfig': Operation not
 * permitted`), git aborts even read-only commands. {@link createGitInspector}
 * detects that condition and only then injects `GIT_CONFIG_NOSYSTEM=1` +
 * `GIT_CONFIG_GLOBAL=/dev/null` so detection still works. In a normal local
 * TUI — this extension's primary runtime — the config *is* readable, so it is
 * left untouched and `insteadOf` URL rewrites (SSH aliases, GHE mirrors,
 * credential-helper remaps) apply as the user expects. Detection commands are
 * read-only, so isolating global/system git config is safe when it happens.
 */
import { accessSync, constants } from 'node:fs';
import { simpleGit, type RemoteWithRefs } from 'simple-git';
import type { GitInspector } from './types';

/** Default config-probe: throws like `fs.accessSync(path, R_OK)` when unreadable. */
const defaultAccess = (path: string): void => {
  accessSync(path, constants.R_OK);
};

/**
 * Environment injected into `simple-git` subprocesses **only when** git's
 * global config can't be read (see {@link shouldIsolateGitConfig}).
 *
 * `simple-git` v4 requires a double opt-in for these: `unsafe: {
 * allowUnsafeConfigPaths: true }` permits the category, and `allowEnvironment`
 * allow-lists the exact env var names passed to `git.env()` (any explicitly
 * supplied var outside the allow-list throws). Only the sandbox vars are ever
 * set explicitly — the ambient environment is never spread into `git.env()`,
 * so no other `GIT_*` value can trip the guard. This only permits the
 * config-path env vars themselves — detection commands are read-only.
 */
const SANDBOX_GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
} as const;

/** Env var names explicitly injected via `git.env()` when isolating.
 *
 * `simple-git` v4 filters ambient environment variables and throws for any
 * *explicitly* supplied var that is not allow-listed here (double opt-in with
 * `unsafe.allowUnsafeConfigPaths`). */
const SANDBOX_GIT_ENV_KEYS = Object.keys(SANDBOX_GIT_ENV);

/**
 * Determine whether git's global/system config should be isolated.
 *
 * Returns `true` only when the user's global git config (`~/.gitconfig`) is
 * present but unreadable due to permissions (`EACCES`/`EPERM`) — the
 * sandboxed-agent condition described above. In a normal local TUI the file is
 * readable, so the config is kept and `insteadOf` rewrites apply.
 *
 * - An **absent** `~/.gitconfig` (`ENOENT`) is benign: git already tolerates a
 *   missing file, so the system config is *not* dropped unnecessarily.
 * - An explicit `GIT_CONFIG_GLOBAL` already in the environment (set by the
 *   user or CI) is always respected — never overridden.
 * - When `HOME` is unset, there's nothing to isolate.
 *
 * @param env   - environment to read from (defaults to `process.env`).
 * @param access - config-probe used to test `~/.gitconfig` readability
 *                (defaults to `fs.accessSync(path, R_OK)`); injectable for tests
 *                so the sandbox `EACCES` path is deterministic on CI (which
 *                often runs as root and would otherwise bypass file perms).
 */
export function shouldIsolateGitConfig(
  env: NodeJS.ProcessEnv = process.env,
  access: (path: string) => void = defaultAccess
): boolean {
  if (env.GIT_CONFIG_GLOBAL !== undefined) {
    return false;
  }
  const home = env.HOME;
  if (!home) {
    return false;
  }
  try {
    access(`${home}/.gitconfig`);
    return false; // readable — local TUI, keep full config
  } catch (err) {
    // Isolate only when the file exists but can't be read (sandbox EACCES/EPERM).
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EACCES' || code === 'EPERM';
  }
}

/**
 * Build a {@link GitInspector} bound to a working directory.
 *
 * `checkIsRepo()` is safe to call outside a repo (returns `false`); the other
 * methods assume a valid repo and are only invoked after `isRepo()` succeeds.
 *
 * Git-config isolation is applied conditionally via
 * {@link shouldIsolateGitConfig}: the sandbox env is injected only when the
 * user's global gitconfig is unreadable. In a normal local TUI the inspector
 * inherits the full process environment untouched.
 *
 * @param cwd    - working directory the inspector is bound to.
 * @param env    - environment to inspect (defaults to `process.env`).
 * @param access - config-probe forwarded to {@link shouldIsolateGitConfig}
 *                 (injectable for tests, same rationale as there).
 */
export function createGitInspector(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  access: (path: string) => void = defaultAccess
): GitInspector {
  const isolate = shouldIsolateGitConfig(env, access);
  const git = simpleGit(cwd, {
    ...(isolate
      ? {
          unsafe: { allowUnsafeConfigPaths: true },
          allowEnvironment: [...SANDBOX_GIT_ENV_KEYS],
        }
      : {}),
  });
  if (isolate) {
    // Only the sandbox overrides are set explicitly. In v4 the git subprocess
    // sees the ambient environment (with `GIT_*` vars filtered by default)
    // merged with these values — spreading the full `process.env` here would
    // make any user-set `GIT_*` var an explicit, un-allowed write and throw.
    git.env({ ...SANDBOX_GIT_ENV });
  }
  return {
    isRepo: () => git.checkIsRepo(),
    status: () => git.status(),
    getRemotes: () => git.getRemotes(true),
  };
}

/**
 * Pick the remote to read owner/repo from.
 *
 * Prefers `origin`; falls back to the first available remote. Returns
 * `undefined` when there are no remotes at all.
 */
export function pickRemote(remotes: readonly RemoteWithRefs[]): RemoteWithRefs | undefined {
  return remotes.find(r => r.name === 'origin') ?? remotes[0];
}
