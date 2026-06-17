/**
 * @file `/handoff`-internal write helpers (git push, PR create/update, comment post).
 *
 * These are command-internal functions, NOT agent tools (the agent is read-only,
 * §2.7). `/handoff` owns all three writes directly: push (`simple-git`),
 * PR create/update (`octokit.pulls`), and the `/pi` handoff comment
 * (`octokit.rest.issues.createComment`). Kept separate from `handoff.ts` so the
 * git/Octokit mechanics are individually testable against temp repos.
 */

import simpleGit, { type StatusResult } from 'simple-git';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';

/**
 * Check whether the working tree is dirty (uncommitted changes).
 *
 * Per §2.1 step 3 / Q7, `/handoff` aborts on a dirty tree and never mutates it
 * (no auto-commit, no auto-stash). This returns the raw status so the handler
 * can report *what* is dirty; the handler decides to abort.
 */
export async function getWorkingTreeStatus(cwd: string): Promise<StatusResult> {
  const git = simpleGit(cwd);
  return git.status();
}

/** Convenience: true iff there's nothing to commit (clean tree). */
export async function isCleanWorkingTree(cwd: string): Promise<boolean> {
  return (await getWorkingTreeStatus(cwd)).isClean();
}

/**
 * Detect the upstream default branch (e.g. `main`), for the local-diff base.
 *
 * **Authoritative source first:** queries `octokit.rest.repos.get` for the
 * repo's true `default_branch`. This is the only way to avoid being fooled by
 * a stale `origin/HEAD` symbolic-ref (which can still resolve successfully
 * while pointing at a retired branch — e.g. `origin/v1` — producing an empty
 * or wrong diff base). `/handoff` is a rare, deliberate action that already
 * makes several API calls, so one extra round-trip for correctness is
 * negligible.
 *
 * **Local fallback** (offline / network error / rate limit): tries
 * `git symbolic-ref refs/remotes/origin/HEAD`, then probes `main`/`master`,
 * then assumes `main`. These can be stale but are strictly better than
 * crashing when the network is unavailable.
 *
 * Per §2.1 step 6, the base is the upstream default branch (the only base
 * available on a create; matches the PR's base on an update — the update path
 * uses the PR's `base.ref` directly and never calls this function).
 */
// fallow-ignore-next-line complexity
export async function detectDefaultBranch(
  cwd: string,
  octokit: OctokitInstance,
  owner: string,
  repo: string
): Promise<string> {
  // --- Authoritative: the repo's actual default branch via API ---
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    if (data.default_branch) {
      return data.default_branch;
    }
  } catch {
    // Network error / rate limit → fall through to local heuristics.
  }

  // --- Local fallback (offline) ---
  const git = simpleGit(cwd);
  try {
    const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    // Form: 'origin/main' → strip the 'origin/' prefix.
    const branch = ref.replace(/^[^/]+\//, '');
    if (branch) {
      return branch;
    }
  } catch {
    // origin/HEAD not set — fall through.
  }
  // Probe common default names. `rev-parse --verify origin/<name>` succeeds
  // iff that remote branch exists.
  for (const candidate of ['main', 'master']) {
    try {
      const result = await git.raw(['rev-parse', '--verify', `origin/${candidate}`]);
      if (result.trim()) {
        return candidate;
      }
    } catch {
      // branch doesn't exist — try the next candidate
    }
  }
  // Last resort: assume main. The diff command will fail clearly if wrong.
  return 'main';
}

/**
 * Get the local diff of the feature branch against the upstream base (§2.1
 * step 6). Triple-dot (`origin/base...HEAD`) captures everything on the
 * feature branch since divergence — works for both create (no PR) and update.
 * Truncation is the caller's job (review pass 11: the provider's
 * `fetchPRDiff` truncates, but `git diff` does not).
 *
 * Returns an empty string if the base branch isn't on origin yet (the user
 * may need to `git fetch`) — `git diff` throws in that case, so we swallow it.
 * The handler surfaces an empty diff as a clear message rather than crashing.
 */
export async function getLocalDiff(cwd: string, base: string): Promise<string> {
  const git = simpleGit(cwd);
  try {
    return (await git.raw(['diff', `origin/${base}...HEAD`])).trim();
  } catch {
    // origin/<base> ref doesn't exist locally (not fetched / fresh clone
    // without the base). No diff to summarize — return empty.
    return '';
  }
}

/**
 * Push the current branch to origin. Idempotent (§2.1 step 8): if the remote
 * already has the branch, this is a no-op or fast-forward. Sets upstream on
 * first push so the branch tracks `origin/<branch>`.
 *
 * **Before pushing**, checks whether the latest commit already contains
 * `[skip ci]`. If not, creates an empty `[skip ci]` marker commit so the
 * push event does not trigger the CI action (which would start reviewing
 * before the `/pi` handoff comment is posted). The `/pi` comment — posted
 * after the push — is the intended trigger for the CI action to process the
 * handoff.
 *
 * This does NOT violate the no-mutate rule (Q7): the working tree was
 * already verified clean (step 3), an empty commit touches no files, and
 * `[skip ci]` is a standard CI-control convention — not "committing work
 * product." Re-running `pushBranch` on an idempotent retry detects the
 * existing `[skip ci]` marker and skips the extra commit.
 */
export async function pushBranch(cwd: string): Promise<void> {
  const git = simpleGit(cwd);

  // Check whether the latest commit already has [skip ci] — if so, skip
  // adding another one (idempotent retry guard). Uses `git.raw` for both
  // log and commit because `simple-git`'s typed `log()` doesn't support
  // `--format=%s` (it overrides the output format with its own parser).
  try {
    const lastMsg = (await git.raw(['log', '-1', '--format=%s'])).trim();
    if (!/\[skip ci\]/i.test(lastMsg)) {
      await git.raw(['commit', '--allow-empty', '-m', '[skip ci] handoff checkpoint']);
    }
  } catch {
    // Log failure is non-fatal: an empty or fresh repo with no commits can
    // still push (it will fail later if there's nothing to push, but that's
    // the caller's problem).
  }

  // -u sets upstream on first push; subsequent pushes fast-forward harmlessly.
  await git.push(['-u', 'origin', 'HEAD']);
}

/**
 * Find an open PR whose head matches the current branch on this owner, if any
 * (§2.1 step 4 — create vs. update). Returns the PR number **and its base
 * branch**, or `undefined`.
 *
 * The base is returned alongside the number so `/handoff`'s update path can
 * use the PR's actual base for the local diff (§2.1 step 6: "on an update it
 * matches the PR's base") instead of guessing via {@link detectDefaultBranch}
 * — which trusts the local `origin/HEAD` symbolic-ref and can be stale/wrong
 * (e.g. it once resolved a repo's retired `v1` branch, producing an empty
 * diff). `pulls.list` already returns `base.ref`, so this costs no extra call.
 *
 * **Limitation:** matches same-owner head branches only (the `head` filter is
 * `owner:branch`). Fork PRs (head on a different owner) are not matched —
 * those need an explicit number, outside `/handoff`'s scope.
 */
export async function findOpenPR(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  branch: string
): Promise<{ number: number; base: string } | undefined> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: 'open',
  });
  const pr = data[0];
  if (!pr) {
    return undefined;
  }
  return { number: pr.number, base: pr.base.ref };
}

/** Minimal template for the PR body (Q6): a branch pointer + a handoff pointer. */
export function buildPRBody(base: string, head: string): string {
  return `**Branch:** \`${head}\` → \`${base}\`\n**Handoff:** see the /pi 🤖 Handoff comment on this PR.`;
}

/**
 * Create a PR (§2.1 step 9, create case). Returns the new PR's number + the
 * author login (for the passive mismatch check, §2.1 step 10).
 */
export async function createPR(
  octokit: OctokitInstance,
  args: { owner: string; repo: string; title: string; head: string; base: string }
): Promise<{ number: number; authorLogin: string }> {
  const { data } = await octokit.rest.pulls.create({
    owner: args.owner,
    repo: args.repo,
    title: args.title,
    head: args.head,
    base: args.base,
    body: buildPRBody(args.base, args.head),
  });
  return { number: data.number, authorLogin: data.user?.login ?? 'unknown' };
}

/**
 * Update an existing PR (§2.1 step 9, update case). Overwrites the body to the
 * template; title updated only if a new one is given (§2.1 step 9 note).
 */
export async function updatePR(
  octokit: OctokitInstance,
  args: {
    owner: string;
    repo: string;
    number: number;
    title?: string;
    head: string;
    base: string;
  }
): Promise<{ number: number; authorLogin: string }> {
  const { data } = await octokit.rest.pulls.update({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.number,
    ...(args.title !== undefined ? { title: args.title } : {}),
    body: buildPRBody(args.base, args.head),
  });
  return { number: data.number, authorLogin: data.user?.login ?? 'unknown' };
}

/**
 * Post the `/pi` handoff comment (§2.1 step 12). The body is the reviewed
 * Done/Next prose with the `/pi` prefix so the CI action picks it up as a
 * normal invocation (§2.5).
 */
export async function postHandoffComment(
  octokit: OctokitInstance,
  args: { owner: string; repo: string; issueNumber: number; body: string }
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: args.owner,
    repo: args.repo,
    issue_number: args.issueNumber,
    body: args.body,
  });
}
