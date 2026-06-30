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
 *   an Opengist gist. By default we therefore point `shareUrl` at the gist's
 *   **raw** web route: the exported HTML is self-contained (session data
 *   inline), and Opengist serves `.html` files with `Content-Type: text/html`
 *   and an `inline` disposition (no restrictive CSP for HTML — only SVG/PDF
 *   get one), so the raw URL renders the full session in any browser with no
 *   viewer dependency. When `PI_SHARE_VIEWER_URL` points at a **non-pi.dev**
 *   viewer (e.g. `gistviewer.l3x.in`), the `shareUrl` is instead built as
 *   `<viewer>#<gistPageUrl>` — a self-hosted viewer that fetches the gist by
 *   URL can render Opengist sessions the same way pi.dev renders GitHub ones.
 *   See https://opengist.io/docs for the API reference.
 */

import {
  type CreateGistInput,
  type CreatedGist,
  type GistProvider,
  GIST_CREATE_TIMEOUT_MS,
  PI_DEV_VIEWER_URL,
  fetchWithTimeout,
  assertGistResponseOk,
  assertGistHasIdAndUrl,
  resolveShareViewerUrl,
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

  await assertGistResponseOk(response);

  const json = (await response.json()) as {
    id?: string;
    html_url?: string;
  };

  assertGistHasIdAndUrl(json);

  // The exported session HTML is fully self-contained, so Opengist's raw web
  // route renders the whole session in a browser with no viewer dependency.
  // The route is `GET /:user/:gistname/raw/:revision/:file`; "HEAD" resolves to
  // the latest revision (the value Opengist uses for its embed view — see
  // https://opengist.io/docs). This is an instance-specific behaviour: if a
  // future Opengist release stops accepting `HEAD` on the raw route, every
  // share link would 404. The tests assert the URL shape, not that it
  // resolves live, so verify the rendered link after upgrading your instance.
  // `html_url` is `<origin>/<user>/<identifier>`, so appending the raw segment
  // yields a stable URL.
  //
  // SECURITY (Opengist only): unlike the GitHub provider — where the session
  // renders on `pi.dev`, an origin isolated from where gists are stored — this
  // raw link is served from the **same origin** as the Opengist app the viewer
  // is logged into. The exported HTML carries the viewer JS plus rendered tool
  // output / file contents, so anything that isn't escaped by the session
  // exporter runs with the Opengist origin's privileges (cookies, authenticated
  // `/api/...` calls) — a stored-XSS vector absent from the GitHub backend.
  // Operators should prefer a dedicated/isolated Opengist instance (or account)
  // for shared sessions; see the README WARNING.
  const base = json.html_url.replace(/\/$/, '');
  const rawUrl = `${base}/raw/HEAD/${encodeURIComponent(filename)}`;

  // By default the raw URL is the share link: it renders the self-contained
  // session standalone in any browser (the gist page only shows the source).
  // When a custom (non-pi.dev) viewer is configured via PI_SHARE_VIEWER_URL,
  // build a viewer link instead: `<viewer>#<gistPageUrl>`. The pi.dev viewer
  // hardcodes api.github.com so it can't read an Opengist gist, but a
  // self-hosted viewer (e.g. gistviewer.l3x.in) that fetches the gist by URL
  // can render Opengist sessions just like pi.dev renders GitHub ones.
  const viewerUrl = resolveShareViewerUrl();
  // Compare hostname (not exact string) so variants like `https://pi.dev/session`
  // (no trailing slash) or `https://PI.DEV/session/` are still recognised as
  // the pi.dev viewer, which can't read an Opengist gist and would otherwise
  // produce a silently broken link. An unparseable viewer URL is treated as a
  // custom viewer (falls through to the viewer link).
  let isPiDevViewer = false;
  try {
    isPiDevViewer = new URL(viewerUrl).hostname === new URL(PI_DEV_VIEWER_URL).hostname;
  } catch {
    // Invalid viewer URL → treat as a custom viewer.
  }
  const shareUrl = isPiDevViewer ? rawUrl : `${viewerUrl}#${base}`;

  return {
    id: json.id,
    gistUrl: json.html_url,
    rawUrl,
    shareUrl,
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
