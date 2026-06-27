/**
 * @file Gist-provider selection for session sharing.
 *
 * Resolves which storage backend ({@link githubGistProvider} or
 * {@link opengistGistProvider}) handles session sharing, and the token used to
 * authenticate against it. Keeping this in a dedicated module avoids a circular
 * import: both providers live in `gist.ts`/`opengist.ts`, while this module is
 * the only one that depends on both.
 */

import type { GistProvider } from './gist';
import { githubGistProvider } from './gist';
import { opengistGistProvider } from './opengist';

/**
 * Configuration subset consumed by the share-provider resolver.
 *
 * Mirrors the share-related fields of `PiConfig` so the resolver is unit-testable
 * without constructing a full config object.
 */
export interface ShareProviderConfig {
  /** Storage backend: `'github'` (default) or `'opengist'`. */
  shareGistProvider?: 'github' | 'opengist';
  /**
   * Gist-creation token for the chosen provider. For Opengist this is an
   * access token (`og_…`) with the `gist:write` scope. Falls back to
   * `githubToken` when unset, preserving backwards compatibility for GitHub.
   */
  shareGistToken?: string;
  /** GitHub token, used as the share token fallback. */
  githubToken?: string;
}

/**
 * Select the gist provider for session sharing.
 *
 * Unknown / unset values fall back to GitHub (the original behaviour), so this
 * is purely additive and existing `share_session` workflows are unaffected.
 */
export function resolveGistProvider(config: ShareProviderConfig): GistProvider {
  return config.shareGistProvider === 'opengist' ? opengistGistProvider : githubGistProvider;
}

/**
 * Resolve the token used to create the shared gist.
 *
 * Prefers `shareGistToken` (letting Opengist users supply an Opengist access
 * token that differs from their GitHub PAT), then falls back to `githubToken`
 * so the GitHub path keeps working with the single `github_token` input.
 */
export function resolveShareToken(config: ShareProviderConfig): string | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional ||: an empty-string token must fall through to the fallback (a "" token would fail auth) */
  return config.shareGistToken || config.githubToken;
}
