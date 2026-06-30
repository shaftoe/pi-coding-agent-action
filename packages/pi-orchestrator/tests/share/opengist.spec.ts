/**
 * Tests for the Opengist session-sharing provider (`createOpengistGist`).
 *
 * Verifies the exact Opengist REST API contract (route, headers, body shape
 * with `visibility`/`title`, and the `files` map), and that the resulting
 * `share_url` is a self-rendering raw-HTML link rather than a pi.dev viewer
 * link (the pi.dev viewer can only read GitHub gists).
 *
 * Reference: https://opengist.io/docs — the create endpoint is
 * `POST /api/gists` (the API lives under `/api/`, not `/api/v1/`), the body
 * uses `visibility: public|unlisted|private` + a `title`, and the response
 * carries `id` + `html_url`. Uses a mocked global `fetch`.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import {
  createOpengistGist,
  opengistGistProvider,
  DEFAULT_OPENGIST_API_PATH,
} from '../../src/share/opengist';
import { GIST_CREATE_TIMEOUT_MS, PI_DEV_VIEWER_URL } from '../../src/share/gist';

describe('createOpengistGist', () => {
  const originalFetch = globalThis.fetch;
  const apiUrl = 'https://gist.l3x.in/api/gists';

  beforeEach(() => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        html_url: 'https://gist.l3x.in/bot/my-session',
        visibility: 'unlisted',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('creates an unlisted gist with the correct Opengist HTTP contract', async () => {
    await createOpengistGist({
      token: 'og_token',
      content: '<html>session</html>',
      apiUrl,
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calls = (globalThis.fetch as any).mock.calls;
    const [url, init] = calls[0];
    // Route is /api/gists (NOT /api/v1/gists — that 404s).
    expect(url).toBe(apiUrl);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    // Bearer auth, not GitHub-specific Accept headers.
    expect(headers.Authorization).toBe('Bearer og_token');
    expect(headers.Accept).toBe('application/json');
    expect(headers).not.toHaveProperty('X-GitHub-Api-Version');

    const body = JSON.parse(init?.body as string);
    // Opengist uses visibility + title, NOT a public boolean.
    expect(body.visibility).toBe('unlisted');
    expect(body.public).toBeUndefined();
    expect(body.title).toBe('Pi agent session');
    // The files map shape matches GitHub's ({ name: { content } }).
    expect(body.files['session.html'].content).toBe('<html>session</html>');
  });

  test('maps the public flag to the visibility enum', async () => {
    await createOpengistGist({
      token: 'og_token',
      content: 'x',
      apiUrl,
      public: true,
      description: 'custom title',
    });

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.visibility).toBe('public');
    expect(body.title).toBe('custom title');
  });

  test('returns a self-rendering raw-HTML share URL (not pi.dev)', async () => {
    const gist = await createOpengistGist({
      token: 'og_token',
      content: 'x',
      apiUrl,
    });

    expect(gist.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(gist.gistUrl).toBe('https://gist.l3x.in/bot/my-session');
    // Raw route: <html_url>/raw/HEAD/<filename> — serves text/html inline,
    // so the self-contained session renders in a browser with no viewer.
    expect(gist.rawUrl).toBe('https://gist.l3x.in/bot/my-session/raw/HEAD/session.html');
    expect(gist.shareUrl).toBe(gist.rawUrl);
    // Must NOT be a pi.dev link (the viewer hardcodes api.github.com).
    expect(gist.shareUrl).not.toContain('pi.dev');
  });

  describe('custom viewer URL (PI_SHARE_VIEWER_URL)', () => {
    const originalViewer = process.env.PI_SHARE_VIEWER_URL;

    afterEach(() => {
      if (originalViewer === undefined) {
        delete process.env.PI_SHARE_VIEWER_URL;
      } else {
        process.env.PI_SHARE_VIEWER_URL = originalViewer;
      }
    });

    test('builds a viewer link when the env var is a custom (non-pi.dev) value', async () => {
      process.env.PI_SHARE_VIEWER_URL = 'https://gistviewer.l3x.in/';
      const gist = await createOpengistGist({
        token: 'og_token',
        content: 'x',
        apiUrl,
      });

      // The viewer reads the gist page URL from the fragment, the same way
      // pi.dev reads a GitHub gist id. Format: <viewer>#<gistPageUrl>.
      expect(gist.shareUrl).toBe('https://gistviewer.l3x.in/#https://gist.l3x.in/bot/my-session');
      // The raw URL is still exposed for clients that fetch the content.
      expect(gist.rawUrl).toBe('https://gist.l3x.in/bot/my-session/raw/HEAD/session.html');
      expect(gist.gistUrl).toBe('https://gist.l3x.in/bot/my-session');
    });

    test('uses the self-rendering raw link when the env var is the pi.dev default', async () => {
      // pi.dev hardcodes api.github.com, so it can't read an Opengist gist —
      // even when explicitly set, the pi.dev value must fall back to the raw link.
      process.env.PI_SHARE_VIEWER_URL = PI_DEV_VIEWER_URL;
      const gist = await createOpengistGist({ token: 'og_token', content: 'x', apiUrl });
      expect(gist.shareUrl).toBe(gist.rawUrl);
      expect(gist.shareUrl).toBe('https://gist.l3x.in/bot/my-session/raw/HEAD/session.html');
    });

    test('recognises pi.dev by hostname even without a trailing slash', async () => {
      // The pi.dev viewer is detected by hostname, not exact-string match, so
      // a natural value like `https://pi.dev/session` (no trailing slash) still
      // falls back to the raw link instead of producing a broken viewer URL.
      process.env.PI_SHARE_VIEWER_URL = 'https://pi.dev/session';
      const gist = await createOpengistGist({ token: 'og_token', content: 'x', apiUrl });
      expect(gist.shareUrl).toBe(gist.rawUrl);
      expect(gist.shareUrl).not.toContain('#');
    });

    test('uses the self-rendering raw link when the env var is unset', async () => {
      delete process.env.PI_SHARE_VIEWER_URL;
      const gist = await createOpengistGist({ token: 'og_token', content: 'x', apiUrl });
      expect(gist.shareUrl).toBe(gist.rawUrl);
    });

    test('uses the self-rendering raw link when the env var is empty', async () => {
      process.env.PI_SHARE_VIEWER_URL = '';
      const gist = await createOpengistGist({ token: 'og_token', content: 'x', apiUrl });
      expect(gist.shareUrl).toBe(gist.rawUrl);
    });
  });

  test('URL-encodes the filename in the raw link', async () => {
    const gist = await createOpengistGist({
      token: 'og_token',
      content: 'x',
      apiUrl,
      filename: 'my session.html',
    });

    expect(gist.rawUrl).toBe('https://gist.l3x.in/bot/my-session/raw/HEAD/my%20session.html');
  });

  test('strips a trailing slash from html_url before building the raw link', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'uuid-1',
        html_url: 'https://gist.l3x.in/bot/my-session/',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const gist = await createOpengistGist({ token: 't', content: 'x', apiUrl });
    expect(gist.rawUrl).toBe('https://gist.l3x.in/bot/my-session/raw/HEAD/session.html');
  });

  test('throws when apiUrl is missing (Opengist is self-hosted)', async () => {
    await expect(createOpengistGist({ token: 't', content: 'x' })).rejects.toThrow(
      new RegExp(`opengist provider requires an API URL.*${DEFAULT_OPENGIST_API_PATH}`)
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('throws with status + body detail on non-2xx', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
      text: async () => '{"message":"invalid token"}',
    })) as unknown as typeof fetch;

    await expect(createOpengistGist({ token: 'bad', content: 'x', apiUrl })).rejects.toThrow(
      /401 Unauthorized.*invalid token/
    );
  });

  test('passes an AbortSignal to fetch for timeout safety', async () => {
    await createOpengistGist({ token: 't', content: 'x', apiUrl });

    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('throws a timeout error when the request aborts', async () => {
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      if (init.signal) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' } as any;
    }) as unknown as typeof fetch;

    await expect(createOpengistGist({ token: 't', content: 'x', apiUrl })).rejects.toThrow(
      `gist create timed out after ${GIST_CREATE_TIMEOUT_MS}ms`
    );
  });

  test('throws when the 2xx response lacks id/html_url (malformed)', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: 'unexpected proxy response' }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(createOpengistGist({ token: 't', content: 'x', apiUrl })).rejects.toThrow(
      /unexpected response.*no id\/html_url/
    );
  });

  test('opengistGistProvider delegates to createOpengistGist', async () => {
    expect(opengistGistProvider.name).toBe('opengist');
    const gist = await opengistGistProvider.create({ token: 't', content: 'x', apiUrl });
    expect(gist.shareUrl).toContain('/raw/HEAD/session.html');
  });
});
