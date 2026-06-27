/**
 * @file Opengist session-sharing provider.
 *
 * Uploads the exported session HTML to a **self-hosted Opengist** instance
 * (https://github.com/thomiceli/opengist) instead of GitHub Gists, so you can
 * keep shared sessions on your own infrastructure (e.g. `gist.l3x.in`).
 *
 * Why a dedicated provider (and not just an `apiUrl` swap on the GitHub one):
 * - **Route:** Opengist's REST API lives under `/api/` — the create endpoint is
 *   `POST <instance>/api/gists` (GitHub's is `POST api.github.com/gists`). The
 *   prior assumption that it was `/api/v1/gists` was wrong; `/api/v1` 404s.
 * - **Body:** Opengist uses a `visibility` string (`public` | `unlisted` |
 *   `private`) where GitHub uses a `public` boolean, and accepts a `title`
 *   field. The `files` map shape (`{ name: { content } }`) happens to match
 *   GitHub's, but the rest of the contract differs.
 * - **Auth:** an Opengist access token (`og_…`) with the `gist:write` scope,
 *   sent as `Authorization: Bearer og_…` — not a GitHub PAT.
 * - **Viewer:** the pi.dev viewer hardcodes `api.github.com`, so it can't read
 *   an Opengist gist. Instead we point `shareUrl` at the gist's **raw** web
 *   route: the exported HTML is self-contained (session data inline), and
 *   Opengist serves `.html` files with `Content-Type: text/html` and an
 *   `inline` disposition (no restrictive CSP for HTML — only SVG/PDF get one),
 *   so the raw URL renders the full session in any browser with no viewer
 *   dependency. See https://opengist.io/docs for the API reference.
 */

import {
  type CreateGistInput,
  type CreatedGist,
  type GistProvider,
  GIST_CREATE_TIMEOUT_MS,
  fetchWithTimeout,
} from './gist';

/**
 * Path appended to an Opengist instance origin to reach the create endpoint.
 *
 * Opengist's REST API is mounted under `/api/` (no version segment), so for an
 * instance at `https://gist.l3x.in` the create URL is
 * `https://gist.l3x.in/api/gists`. Used only to build a friendly error message
 * — the real endpoint always comes from {@link CreateGistInput.apiUrl}.
 */
export const DEFAULT_OPENGIST_API_PATH = '/api/gists';

/**
 * Create a gist on an Opengist instance and return a self-rendering share link.
 *
 * @param input - Gist creation parameters. `apiUrl` **must** be set to the
 *   instance's create endpoint (e.g. `https://gist.l3x.in/api/gists`); there is
 *   no sensible default since Opengist is self-hosted.
 * @returns The created gist details + a raw-HTML share URL.
 * @throws when the API call fails (non-2xx) or the response is malformed.
 */
export async function createOpengistGist(input: CreateGistInput): Promise<CreatedGist> {
  const {
    token,
    content,
    filename = 'session.html',
    description = 'Pi agent session',
    public: isPublic = false,
    apiUrl,
  } = input;

  if (!apiUrl) {
    throw new Error(
      `opengist provider requires an API URL (e.g. https://gist.l3x.in${DEFAULT_OPENGIST_API_PATH}); ` +
        'set share_gist_api_url'
    );
  }

  // Opengist uses a `visibility` enum instead of GitHub's `public` boolean.
  // `unlisted` is the closest analogue of a GitHub "secret" gist: it doesn't
  // appear in public listings but is readable by anyone who has the
  // (unguessable) URL — exactly the "URL-obscured, not access-controlled"
  // model the GitHub provider documents.
  const visibility: 'public' | 'unlisted' = isPublic ? 'public' : 'unlisted';

  const response = await fetchWithTimeout(
    apiUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'pi-coding-agent-action',
      },
      body: JSON.stringify({
        title: description,
        visibility,
        files: { [filename]: { content } },
      }),
    },
    GIST_CREATE_TIMEOUT_MS
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `gist create failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }

  const json = (await response.json()) as {
    id?: string;
    html_url?: string;
    slug_url?: string;
  };

  if (!json.id || !json.html_url) {
    throw new Error(
      `gist create returned unexpected response (no id/html_url): ${JSON.stringify(json).slice(0, 200)}`
    );
  }

  // The exported session HTML is fully self-contained, so Opengist's raw web
  // route renders the whole session in a browser with no viewer dependency.
  // The route is `GET /:user/:gistname/raw/:revision/:file`; "HEAD" resolves to
  // the latest revision (the same value Opengist uses internally for its embed
  // view). `html_url` is `<origin>/<user>/<identifier>`, so appending the raw
  // segment yields a stable, always-valid URL.
  const base = json.html_url.replace(/\/$/, '');
  const rawUrl = `${base}/raw/HEAD/${encodeURIComponent(filename)}`;

  return {
    id: json.id,
    gistUrl: json.html_url,
    rawUrl,
    // The raw URL is the primary share link because it renders the session
    // standalone; the gist page (gistUrl) only shows the HTML source.
    shareUrl: rawUrl,
  };
}

/**
 * Opengist provider. Implements {@link GistProvider} so the orchestrator
 * treats it identically to the GitHub provider — only the request/response
 * contract and the resulting share URL differ.
 */
export const opengistGistProvider: GistProvider = {
  name: 'opengist',
  create: createOpengistGist,
};
