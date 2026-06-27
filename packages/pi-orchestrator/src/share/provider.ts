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
   * access token (`og_…`) with the `gist:write` scope.
   */
  shareGistToken?: string;
  /** GitHub token, used as the share token for the github provider. */
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
 * Resolve the token used to create the shared gist, picking the credential
 * that matches the selected provider and only crossing over when the
 * preferred token is absent.
 *
 * - **opengist** prefers `shareGistToken` (an `og_…` token), falling back to
 *   `githubToken`.
 * - **github** (default) prefers `githubToken`, falling back to
 *   `shareGistToken`.
 *
 * This provider-aware selection prevents mismatched combos — e.g. an `og_`
 * Opengist token being sent to `api.github.com`, or a `ghp_` GitHub token
 * being sent to an Opengist instance — from producing confusing auth
 * failures, while keeping the single-`github_token` GitHub workflow intact.
 */
export function resolveShareToken(config: ShareProviderConfig): string | undefined {
  const isOpengist = config.shareGistProvider === 'opengist';
  const primary = isOpengist ? config.shareGistToken : config.githubToken;
  const fallback = isOpengist ? config.githubToken : config.shareGistToken;
  /* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional ||: an empty-string token must fall through to the fallback (a "" token would fail auth) */
  return primary || fallback;
}
