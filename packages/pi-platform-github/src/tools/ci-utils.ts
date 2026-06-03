/**
 * @file Shared utilities for CI/CD tool implementations.
 */

/**
 * Returns a human-readable status icon for the given CI status and conclusion.
 *
 * @param status - The run/job status (e.g. "completed", "in_progress", "queued").
 * @param conclusion - The run/job conclusion (e.g. "success", "failure", "cancelled").
 */
export function getStatusIcon(
  status: string | null | undefined,
  conclusion: string | null | undefined
): string {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return '✅';
      case 'failure':
        return '❌';
      case 'cancelled':
        return '⛔';
      default:
        return '⚠️';
    }
  }
  if (status === 'in_progress') {
    return '🔄';
  }
  return '⏳';
}
