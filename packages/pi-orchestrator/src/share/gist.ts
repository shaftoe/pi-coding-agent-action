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
 *   fail to load).
 */

/** Default pi.dev session viewer base URL (trailing slash). */
export const DEFAULT_SHARE_VIEWER_URL = 'https://pi.dev/session/';

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

/** Inputs for {@link createSessionGist}. */
export interface CreateGistInput {
  /**
   * GitHub token with `gist` scope (classic PAT) **or** fine-grained PAT /
   * GitHub App installation token with the "Gists: read/write" account
   * permission.
   *
   * The default Actions `GITHUB_TOKEN` **cannot** create gists — gists are
   * not in its scope set.
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

  const response = await fetch(apiUrl, {
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
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `gist create failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }

  const json = (await response.json()) as {
    id: string;
    html_url: string;
    files?: Record<string, { raw_url?: string }>;
  };

  const file = json.files?.[filename];

  return {
    id: json.id,
    gistUrl: json.html_url,
    rawUrl: file?.raw_url ?? '',
    shareUrl: `${viewerUrl}#${json.id}`,
  };
}
