# Issue #271 — Sustainable version management: the plan

## Problem (root cause, verified)

1. `@v2` and `@develop` both resolve to **branch HEADs** (no `v2` tag exists), so the **committed `dist/` on each branch is actually executed in production**. Dist must be committed on both branches.
2. `composeActionVersion()` sniffs git branch via `isomorphic-git`. It emits a `-dev+…` suffix unless `branch === 'v2'`. So `package.yml` bakes `2.19.3-dev+develop.<sha>` into develop's committed dist.
3. `promote-develop-to-v2.yml` fast-forwards `v2 ← develop`. For a window — and **forever if semantic-release finds no releasable commits** — v2's HEAD carries develop's dev-versioned dist. Since `@v2` = v2's HEAD, users run the dev build.

Two distinct defects: (a) the post-promote window, (b) the no-releasable-commits case where it never self-corrects.

## Invariants (must hold after the fix)

- **INV-1:** `v2` is always a **strict ancestor of `develop`** (no v2-only commits) → `promote`'s `merge --ff-only` never breaks. Preserved today by humans; enforced by promote's check.
- **INV-2:** The committed `dist/` at `v2`'s HEAD always carries the **bare** version (`<base>`, e.g. `2.19.3`).
- **INV-3:** The committed `dist/` at `develop`'s HEAD always carries a **dev** version (`<base>-<branch>.<sha>`).
- **INV-4:** **Zero window** on `@v2` between promote and release commit.
- **CONTRACT:** `package.ts` reads **only** GitHub-native env vars: `GITHUB_REF_NAME` and `GITHUB_SHA`. No `isomorphic-git`, no `git` CLI, no custom override vars, no `RELEASE_BUILD`. Release-ness is derived from `/^v\d+$/` matching `GITHUB_REF_NAME`. Local builds with no env → `<base>-unknown.unknown`.

The derivation is safe-by-design: if a release context ever lacks `GITHUB_REF_NAME`, it falls through to **dev** (the non-catastrophic direction — v2 would show a dev suffix, never the reverse).

## New version format

| Build | `GITHUB_REF_NAME` | Output |
|---|---|---|
| Release (on `v2`, or future `v3`…) | `v2` | `2.19.3` |
| Dev (on any non-`vN` branch) | `develop` | `2.19.3-develop.9272858` |
| Local (no env) | unset | `2.19.3-unknown.unknown` |

Note this **moves the suffix from semver build-metadata (`+`) to prerelease (`-`)**. Benefits: correct ordering (`2.19.3-develop.abc < 2.19.3`), "is it a release?" = "has prerelease segment?", and matches the "no `dev`, just `-<branch>.<sha>`" requirement.

## Architecture (decisions, all resolved)

- **R3 flow** — `promote` is dispatched **on `v2`** (guarded). Builds the bare dist *locally*, commits, pushes **both** `v2` and `develop` (to keep v2 a strict ancestor — INV-1), then **dispatches** (new run) `package.yml` on `develop` to rebuild+commit the dev-dist (ambient `GITHUB_REF_NAME=develop`). Then dispatches `release.yml`. This is the only design honoring all four invariants + native-vars-only + zero-window.
- **P3 primitive** — a thin reusable `rebuild-dist` workflow: `checkout → install → bun run package (respecting ambient env) → force-add gitignored dist → commit [skip ci] → push to ${{ github.ref_name }}`. No `release-build` input (correctness comes from dispatch context). Used by `package.yml`, `daily-deps-update`. Promote does the dual-push itself (topology is promote-specific policy, not the primitive's job).
- **(α)** — dev-dist for develop comes from dispatching `package.yml` (new run, ambient ref `develop`), not from inside promote. Keeps `package.ts` pure and labels honest.

## Topology per cycle

```
before promote:  ...─ A(dev) ← develop
                 ...─ A ← v2          (v2 ancestor of develop; A dev-dist on both)

after promote:   ...─ A ─ R(bare) ← v2
                       R(bare) ─ D(dev) ← develop   (v2 strict ancestor of develop)
```
- `R` = release-dist commit, built & committed locally in promote-on-v2, pushed to both branches.
- `D` = dev-dist rebuild commit, from package.yml dispatched on develop.
- `release.yml` later may add its own release commit (tag/version bump) on top of `R` — also a strict ancestor of develop once develop next advances. INV-1 preserved across cycles.

---

## File-by-file changes

### 1. `packages/pi-action/scripts/package.ts` — **pure env-var version logic**

Replace the entire git-metadata block (`GitBuildMetadata`/`formatGitMetadata`/`getGitBuildMetadata`/`resolveGitMeta`/`sanitizeSemverIdent`) and `composeActionVersion` with:

```ts
/**
 * Regex matching release branches: v2, v3, v10, …
 * Exported for unit testing.
 */
export const RELEASE_BRANCH_RE = /^v\d+$/;

/** Resolve branch name from GitHub-native env, falling back to 'unknown'. */
function resolveBranch(): string {
  return process.env.GITHUB_REF_NAME ?? 'unknown';
}

/** Resolve short (7-char) SHA from GitHub-native env, falling back to 'unknown'. */
function resolveSha(): string {
  return (process.env.GITHUB_SHA ?? 'unknown').slice(0, 7);
}

/** Sanitize for semver prerelease identifiers: only [0-9A-Za-z-], dot-sep. */
function sanitizeSemverIdent(ident: string): string {
  return ident.replace(/[^0-9A-Za-z-]/g, '-');
}

/**
 * Compose the action version from base version + ambient GitHub env.
 * - Release branch (GITHUB_REF_NAME matches /^v\d+$/): bare base semver.
 * - Otherwise: <base>-<branch>.<sha> (semver prerelease).
 * Exported for unit testing.
 */
export function composeActionVersion(
  baseVersion: string,
  branch: string = resolveBranch(),
  sha: string = resolveSha()
): string {
  if (RELEASE_BRANCH_RE.test(branch)) {
    return baseVersion;
  }
  return `${baseVersion}-${sanitizeSemverIdent(branch)}.${sanitizeSemverIdent(sha)}`;
}
```

`buildDist()` becomes:
```ts
const baseVersion = readJsonVersion(join(cwd, 'package.json'));
const version = composeActionVersion(baseVersion);
```
Drop the `gitMeta` log fields (or replace with: `branch: ${process.env.GITHUB_REF_NAME ?? 'unknown'}`).

**Removals:** `import git from 'isomorphic-git'`, the `existsSync`/`join` for `.git`, and the entire metadata-returning path. `readJsonVersion`, `patchSDKLoaderPlugin`, `copyAllSdkAssets` etc. unchanged.

### 2. `packages/pi-orchestrator/src/version.ts` — **prerelease-aware parser**

Rewrite `parseActionBuildInfo` to parse the **prerelease** format `2.19.3-develop.9272858` (no `+`, no `dev` literal):

```ts
// Parse: <baseVersion>[-<branch>.<sha>]   (prerelease, not build-metadata)
function parseActionBuildInfo(fullVersion: string): ActionBuildInfo {
  if (fullVersion === 'unknown') {
    return { version: 'unknown', isDev: false, branch: undefined, sha: undefined, fullVersion };
  }
  const dashIndex = fullVersion.indexOf('-');
  if (dashIndex === -1) {
    return { version: fullVersion, isDev: false, branch: undefined, sha: undefined, fullVersion };
  }
  const base = fullVersion.slice(0, dashIndex);
  const prerelease = fullVersion.slice(dashIndex + 1);      // e.g. "develop.9272858"
  const dot = prerelease.lastIndexOf('.');
  const branch = dot === -1 ? prerelease : prerelease.slice(0, dot);
  const sha    = dot === -1 ? undefined : prerelease.slice(dot + 1);
  return { version: base, isDev: true, branch, sha, fullVersion };
}
```

`formatActionVersion()` stays the same shape — output `2.19.3-develop (develop @ 9272858)` for dev, `2.19.3` for release. Update the module docstring's "Version scheme" block to the new format. **No** mention of `isomorphic-git`, `dev+…`, or `RELEASE_BUILD`.

### 3. Dependencies — **remove `isomorphic-git`**

From `package.json` (root) and `packages/pi-action/package.json`: delete `"isomorphic-git": "^1.38.4"`. Run `bun install` to update `bun.lock` (drops ~49 transitive deps: `async-lock`, `clean-git-ref`, `crc-32`, `diff3`, `pako`, `pify`, `sha.js`, `simple-get`, etc.).

### 4. `.github/workflows/rebuild-dist.yml` — **NEW thin reusable primitive**

```yaml
name: Rebuild dist

on:
  workflow_call:
    inputs:
      commit-message:
        description: 'Commit message for the dist rebuild'
        required: false
        default: 'chore: rebuild dist [skip ci]'
        type: string

permissions:
  contents: write

jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run package
      - name: Check for dist changes
        id: check
        run: |
          git add -f dist/
          if git diff --cached --exit-code -- dist/; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            git reset -- dist/ > /dev/null 2>&1 || true
          else
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi
      - name: Commit and push
        if: steps.check.outputs.changed == 'true'
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git commit --no-verify -m "${{ inputs.commit-message }}"
          git push origin "${GITHUB_REF_NAME}"
```

### 5. `.github/workflows/package.yml` — **delegate to rebuild-dist**

- Keep `on: push: branches: [develop]` + `paths:` filters (ambient `GITHUB_REF_NAME=develop` → dev dist) — this stays the normal "source changed on develop" path.
- Keep the README-deps update step (rebuild-dist doesn't own that).
- Replace the inline `install/build/check/commit/push` block with `uses: ./.github/workflows/rebuild-dist.yml`. Pass `commit-message: 'chore: update dist and README deps [skip ci]'` only if README also changed; else default.

### 6. `.github/workflows/promote-develop-to-v2.yml` — **R3: dispatch-on-v2, dual-push, dispatch dev-rebuild**

```yaml
jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - name: Guard: must run on v2
        run: |
          if [ "${GITHUB_REF_NAME}" != "v2" ]; then
            echo "::error::promote must be dispatched on 'v2' (got '${GITHUB_REF_NAME}')"
            exit 1
          fi

      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          ref: v2

      - name: Check fast-forward feasibility
        id: check
        run: |
          git fetch origin develop
          MERGE_BASE=$(git merge-base origin/v2 origin/develop)
          [ "$MERGE_BASE" = "$(git rev-parse origin/v2)" ] || { echo "::error::v2 diverged"; exit 1; }

      - name: Fast-forward v2 to develop
        run: git merge --ff-only origin/develop

      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile

      - name: Rebuild bare (release) dist  # ambient GITHUB_REF_NAME=v2
        run: bun run package

      - name: Dry run — skip push
        if: inputs.dry_run == 'true'
        run: git log --oneline origin/v2..HEAD

      - name: Push to both v2 and develop  # INV-1: keep v2 strict ancestor of develop
        if: inputs.dry_run != 'true'
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git add -f dist/
          git commit --no-verify -m "chore: release dist v$(node -p "require('./package.json').version") [skip ci]" || true
          git push origin v2
          git push origin v2:develop

      - name: Dispatch package.yml on develop  # (α): restore dev suffix on develop
        if: inputs.dry_run != 'true'
        uses: actions/github-script@v9
        with:
          github-token: ${{ secrets.GH_PAT }}
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner, repo: context.repo.repo,
              workflow_id: 'package.yml', ref: 'develop',
            });

      - name: Dispatch release.yml  # tag/version bump/GitHub release (optional, idempotent)
        if: inputs.dry_run != 'true'
        uses: actions/github-script@v9
        with:
          github-token: ${{ secrets.GH_PAT }}
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner, repo: context.repo.repo,
              workflow_id: 'release.yml', ref: 'v2',
            });
```

(`triggers:` stays `workflow_dispatch`; the guard makes the dispatch-ref load-bearing.)

### 7. `.github/workflows/release.yml` — **minimal change**

- Keep `on: push: branches: [v2]` + the `test-and-coverage` (`needs:`) gate.
- `.releaserc.json`'s `prepareCmd` already runs `bun run package`; ambient `GITHUB_REF_NAME=v2` → bare dist. **No logic change** to release.yml or `.releaserc.json`.
- Optional: route the build step through `rebuild-dist.yml` for DRY (its `bun run package` would run inside release.yml's job → bare). Skip if it complicates semantic-release's working-tree expectations.

### 8. Tests

**`packages/pi-action/tests/scripts/package-helpers.spec.ts`** (existing — where `composeActionVersion`/`readJsonVersion` tests live):
- Remove all tests touching `formatGitMetadata`/`resolveGitMeta`/`isomorphic-git`.
- Add: `composeActionVersion('2.19.3', 'v2')` → `'2.19.3'`; `('2.19.3', 'v3')` → `'2.19.3'`; `('2.19.3', 'develop', '9272858')` → `'2.19.3-develop.9272858'`; `('2.19.3', 'feature/foo', 'abcdef1')` → `'2.19.3-feature-foo.abcdef1'` (slash → dash); `('2.19.3', 'unknown', 'unknown')` → `'2.19.3-unknown.unknown'`; default-args reads `process.env.GITHUB_REF_NAME`/`GITHUB_SHA`.

**`packages/pi-orchestrator/tests/version.spec.ts`**:
- Update `parseActionBuildInfo`/`formatActionVersion` cases to the new format: bare → release; `2.19.3-develop.9272858` → `{isDev:true, branch:'develop', sha:'9272858'}` → formats `2.19.3-develop (develop @ 9272858)`. Remove `+`/`-dev+` cases.

### 9. Docs

- `version.ts` module docstring: new scheme (prerelease, no `dev`, native-env only).
- `package.ts` docstrings: env-var-only, no git libs.
- No CHANGELOG edits (AGENTS.md rule #8).

## Validation

```bash
bun run validate          # ESLint + tsc --noEmit + Prettier
bun test                  # updated package-helpers + version specs, full suite
# Manual smoke (no env)   → 2.19.3-unknown.unknown
GITHUB_REF_NAME=v2 bun run package            → bare 2.19.3
GITHUB_REF_NAME=develop GITHUB_SHA=<sha> bun run package → 2.19.3-develop.<sha>
```

## Risk register

| Risk | Mitigation |
|---|---|
| `package.yml` (dispatched by promote) races `release.yml` on develop | release.yml runs on **v2** (different branch); package.yml dispatched on **develop**. No shared branch, no race. |
| Promote's `git push origin v2:develop` fails (protection) | `permissions: contents: write` + `GH_PAT`. Add explicit failure messaging. |
| `GITHUB_REF_NAME` ever unset in a release context | Safe failure: falls to **dev** suffix (v2 shows dev, never bare-on-develop). |
| New `v3` release branch | Regex `/^v\d+$/` handles it; no code change. |
| `rebuild-dist` reusable workflow can't see develop's ambient ref when called from promote-on-v2 | By design — we **dispatch** (not call) package.yml for the dev rebuild, so it's a fresh run with `GITHUB_REF_NAME=develop`. |

## Open question worth your eye

One thing deliberately left as "minimal change": **should `release.yml`'s build step also route through `rebuild-dist.yml`?** DRY argues yes; but semantic-release's `prepareCmd` runs `bun run package` *and* mutates `package.json`'s version in the same job, and routing the commit/push through a separate workflow could fight semantic-release's own `@semantic-release/git` commit. Recommendation: **leaving release.yml's build inline** (as it is today) and only adopting `rebuild-dist` for `package.yml`, `daily-deps-update`, and the promote path. If full DRY is wanted, semantic-release's working-tree assumptions need verification first.
