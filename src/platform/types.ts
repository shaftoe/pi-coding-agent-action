/**
 * @file Platform type definitions.
 *
 * Defines types for platform detection and configuration.
 * Supports GitHub, Codeberg, and Forgejo (including self-hosted instances).
 */

/**
 * Supported Git hosting platform types.
 *
 * - `github` - GitHub.com or GitHub Enterprise
 * - `codeberg` - Codeberg.org (Forgejo-based)
 * - `forgejo` - Self-hosted Forgejo instances
 */
export type PlatformType = 'github' | 'codeberg' | 'forgejo';

/**
 * Platform configuration resolved from environment variables.
 *
 * Provides the server URL and API base URL needed to communicate
 * with the Git hosting platform's REST API.
 */
export interface PlatformConfig {
  /** The detected platform type. */
  type: PlatformType;
  /** The web URL of the Git hosting server (e.g., "https://github.com"). */
  serverUrl: string;
  /** The REST API base URL (e.g., "https://api.github.com" or "https://codeberg.org/api/v1"). */
  apiBaseUrl: string;
}
