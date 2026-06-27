/**
 * @file GitHub Gist session sharing.
 *
 * Replicates the pi `/share` command's behaviour without the `gh` CLI: it
 * uploads the exported session HTML to a **secret** GitHub Gist using the
 * REST API and returns a pi.dev-compatible viewer link
 * (`<viewerUrl>#<gistId>`).
 *
 * Design notes:
 * - **No `gh` CLI, no Octokit, no platform coupling.** Uses the global
 *   `fetch` (Node 18+, the action runs on node24). The gist is always
 *   created against `api.github.com` (or an explicit override), so the
 *   *runner* can live anywhere — GitHub Actions, Forgejo CI, Gitea Actions,
 *   or a laptop — as long as it can reach `api.github.com` and holds a
 *   GitHub PAT/App token with gist scope.
 * - This is intentionally **not** a {@link PlatformProvider} method: gists
 *   are a GitHub feature (Forgejo/Gitea have no gist API yet) and the
 *   viewer (`pi.dev/session`) only reads from GitHub's gist hosts, so the
 *   target is always github.com regardless of where the runner lives.
 * - The default viewer URL matches the pi SDK's
 *   `getShareViewerUrl()` (`https://pi.dev/session/`), producing links of
 *   the form `https://pi.dev/session/#<gistId>` (note the `#` fragment —
 *   the viewer reads `location.hash`, so a slash-path URL would silently
 *   fail to load). The `PI_SHARE_VIEWER_URL` env var overrides the default,
 *   giving parity with the interactive `/share` command for users who
 *   self-host the viewer.
 */

/**
 * Default session viewer base URL (trailing slash).
 *
 * Respects the `PI_SHARE_VIEWER_URL` environment variable so users who
 * self-host the viewer can point the CI action at the same URL they use
 * for pi's interactive `/share` command. Falls back to pi.dev.
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional ||: empty-string env var must fall through to the default (a "" viewer URL would produce broken share links) */
export const DEFAULT_SHARE_VIEWER_URL =
  process.env.PI_SHARE_VIEWER_URL || 'https://pi.dev/session/';
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/** Default GitHub Gist REST API endpoint. */
export const DEFAULT_GITHUB_GIST_API = 'https://api.github.com/gists';

/**
 * Maximum content size (bytes) accepted by {@link createSessionGist}.
 *
 * The GitHub Gist REST API rejects oversized payloads with a generic 422
 * error. This guard lets the caller skip with an actionable notice instead.
 * 10 MB is a conservative practical ceiling (the API's hard limit is higher
 * but undocumented); session HTML rarely exceeds a few MB.
 */
export const MAX_GIST_CONTENT_BYTES = 10 * 1024 * 1024;

/**
 * Timeout (ms) for the gist creation request.
 *
 * Sharing is best-effort, so we'd rather abort and log a notice than hang
 * the entire action until the job timeout kills it. 15 s is generous for
 * uploading a few MB of HTML.
 */
export const GIST_CREATE_TIMEOUT_MS = 15_000;

/**
 * Identity of a gist-storage backend (GitHub Gists, Opengist, …).
 *
 * Each provider speaks its own create-API contract and builds a
 * {@link CreatedGist} with an appropriate `shareUrl` (GitHub → pi.dev
 * viewer; Opengist → a self-rendering raw-HTML link).
 */
export interface GistProvider {
  /** Stable identifier (`'github'` | `'opengist'`), used in logs. */
  readonly name: 'github' | 'opengist';
  /** Create a gist holding the session content and return share details. */
  create(input: CreateGistInput): Promise<CreatedGist>;
}

/**
 * POST JSON to `url` with an AbortController-based timeout, translating an
 * `AbortError` into an actionable timeout message.
 *
 * Shared by all gist providers so the timeout/abort behaviour is identical
 * regardless of the backend's request shape. The caller owns the headers and
 * body; this helper only attaches the timeout signal.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = GIST_CREATE_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`gist create timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Minimum shape shared by every gist-create response we understand
 * (GitHub Gists and Opengist both return `id` + `html_url`).
 */
export interface GistCreateResponse {
  id?: string;
  html_url?: string;
}

/**
 * Throw an actionable error when a gist-create response is non-2xx.
 *
 * Shared by all providers so the error wording is identical regardless of
 * the backend. Reads the body only on the failure path.
 */
export async function assertGistResponseOk(response: Response): Promise<void> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `gist create failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }
}

/**
 * Guard against a 2xx response with an unexpected shape (proxy interference,
 * partial response, future API change). Without this, a malformed response
 * silently produces `undefined` ids/urls and a `<viewer>#undefined` share link.
 *
 * Shared by all providers — both GitHub and Opengist return `id` + `html_url`.
 * Implemented as a generic `asserts` so callers keep type narrowing on `id` /
 * `html_url` (and any extra fields they declared on the response type).
 */
export function assertGistHasIdAndUrl<T extends GistCreateResponse>(
  json: T
): asserts json is T & { id: string; html_url: string } {
  if (!json.id || !json.html_url) {
    throw new Error(
      `gist create returned unexpected response (no id/html_url): ${JSON.stringify(json).slice(0, 200)}`
    );
  }
}

/** Inputs for {@link createSessionGist}. */
export interface CreateGistInput {
  /**
   * GitHub token with `gist` scope (classic PAT) **or** fine-grained PAT /
   * GitHub App installation token with the "Gists: read/write" account
   * permission.
   *
   * The default Actions `GITHUB_TOKEN` **cannot** create gists — gists are
   * not in its scope set. Use a PAT/App token via the `github_token` input
   * when {@link shareSession} is enabled.
   */
  token: string;
  /** File contents — typically the exported session HTML. */
  content: string;
  /** Filename inside the gist. Defaults to `session.html`. */
  filename?: string;
  /** Gist description. Defaults to a generic label. */
  description?: string;
  /**
   * `false` (default) = secret/unlisted gist (matches pi `/share`).
   * Secret gists are URL-obscured, **not** access-controlled: anyone with
   * the link can read them.
   */
  public?: boolean;
  /**
   * Override the gist API base URL (e.g. a GitHub Enterprise endpoint).
   * Defaults to {@link DEFAULT_GITHUB_GIST_API}.
   */
  apiUrl?: string;
}

/** Result of a successful gist creation. */
export interface CreatedGist {
  /** Gist ID (extracted from the API response). */
  id: string;
  /** Human-facing gist URL, e.g. `https://gist.github.com/<user>/<id>`. */
  gistUrl: string;
  /** Raw file URL (CORS-enabled), for clients that fetch the content. */
  rawUrl: string;
  /**
   * Viewer link ready to share, e.g. `https://pi.dev/session/#<id>`.
   * Built as `${viewerUrl}#${id}`.
   */
  shareUrl: string;
}

/**
 * Create a secret GitHub Gist and return a pi.dev-style viewer link.
 *
 * @param input - Gist creation parameters.
 * @param viewerUrl - Viewer base URL (defaults to pi.dev).
 * @returns The created gist details + share URL.
 * @throws when the API call fails (non-2xx) or the response is malformed.
 */
export async function createSessionGist(
  input: CreateGistInput,
  viewerUrl: string = DEFAULT_SHARE_VIEWER_URL
): Promise<CreatedGist> {
  const {
    token,
    content,
    filename = 'session.html',
    description = 'Pi agent session',
    public: isPublic = false,
    apiUrl = DEFAULT_GITHUB_GIST_API,
  } = input;

  // Abort the request if it stalls so a hung connection can't block the
  // entire action. The surrounding runSessionShare catch logs the timeout
  // error as a notice and the run continues.
  const response = await fetchWithTimeout(
    apiUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'pi-coding-agent-action',
      },
      body: JSON.stringify({
        description,
        public: isPublic,
        files: { [filename]: { content } },
      }),
    },
    GIST_CREATE_TIMEOUT_MS
  );

  await assertGistResponseOk(response);

  const json = (await response.json()) as {
    id?: string;
    html_url?: string;
    files?: Record<string, { raw_url?: string }>;
  };

  assertGistHasIdAndUrl(json);

  const file = json.files?.[filename];

  return {
    id: json.id,
    gistUrl: json.html_url,
    rawUrl: file?.raw_url ?? '',
    shareUrl: `${viewerUrl}#${json.id}`,
  };
}

/**
 * GitHub Gists provider (default). Wraps {@link createSessionGist} behind the
 * {@link GistProvider} interface so the orchestrator is agnostic to the
 * storage backend. The viewer URL defaults to {@link DEFAULT_SHARE_VIEWER_URL}
 * (honours `PI_SHARE_VIEWER_URL`).
 */
export const githubGistProvider: GistProvider = {
  name: 'github',
  create: (input: CreateGistInput) => createSessionGist(input),
};
