/**
 * @file Formatting helpers shared across packages.
 *
 * Centralizes cost/token formatting so the action logs (orchestrator) and
 * the comment footer (`pi-platform-github`) stay consistent. Lives in the
 * orchestrator package so downstream platform packages can consume it via
 * `@alexanderfortin/pi-orchestrator`.
 */

/**
 * Format a monetary cost for display, omitting it when effectively zero.
 *
 * Cost is rendered via `Math.abs()` to accommodate pay-as-you-go providers
 * (e.g. ppq.ai) that report spending as a negative number against an
 * account balance. The value is rounded to `precision` decimals **before**
 * the zero-threshold check, so that tiny positive costs (e.g. `0.00001`)
 * that round back to `"0.0000"` are omitted rather than shown as `$0.0000`.
 *
 * @param cost - The raw cost value (may be negative).
 * @param precision - Number of decimal places.
 * @returns The formatted string (e.g. `"0.0420"`) without a currency
 *          symbol, or `undefined` when the rounded value is zero.
 */
export function formatCost(cost: number, precision: number): string | undefined {
  const formatted = Math.abs(cost).toFixed(precision);
  return Number(formatted) > 0 ? formatted : undefined;
}
