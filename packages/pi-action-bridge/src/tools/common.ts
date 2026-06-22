/**
 * @file Shared bits for the three bridge tools.
 *
 * Pulls together the duplication the `post_pr_comment` and `read_pr_thread`
 * tools would otherwise each re-declare: the canonical forge web URL, the
 * `server_url` param defaulting, and the common `owner`/`repo`/`number`/
 * `server_url` typebox parameter fields (every thread-shaped tool takes the
 * same repo target). `detect_pull_request` does not take params, so it has no
 * use for these.
 *
 * Kept framework-agnostic: only `typebox` field schemas + a pure resolver.
 */
import { Type } from 'typebox';

/** Canonical web URL used when no `server_url` is supplied (github.com). */
export const DEFAULT_SERVER_URL = 'https://github.com';

/**
 * Resolve a tool's `server_url` param to a concrete forge URL.
 *
 * Blank / whitespace-only values fall back to {@link DEFAULT_SERVER_URL} so a
 * stray empty string never reaches `apiBaseUrlFromServerUrl` (which throws on
 * empty input).
 */
export function resolveServerUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SERVER_URL;
}

// ---------------------------------------------------------------------------
// Shared typebox parameter fields
// ---------------------------------------------------------------------------

/** `owner` field — repository owner login. */
export const ownerField = Type.String({ minLength: 1, description: 'Repository owner (login).' });

/** `repo` field — repository name. */
export const repoField = Type.String({ minLength: 1, description: 'Repository name.' });

/** `server_url` field — optional forge web URL (defaults to github.com). */
export const serverUrlField = Type.Optional(
  Type.String({
    description:
      'Forge web URL (e.g. https://github.com, https://codeberg.org). Defaults to https://github.com.',
  })
);

/**
 * `number` field for a PR/issue target.
 *
 * Takes a `description` because the verb differs per tool ("to comment on" vs
 * "to read"); the `minimum: 1` constraint is shared and enforces a valid
 * integer with no shell-injection surface.
 */
export const prNumberField = (description: string) => Type.Integer({ minimum: 1, description });
