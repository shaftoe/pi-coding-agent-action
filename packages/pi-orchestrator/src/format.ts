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

/**
 * Compose a comment body from the run's assistant text messages, folding
 * everything except the last message under a collapsible `<details>` block.
 *
 * - 0 messages → empty string (caller applies its own fallback)
 * - 1 message → that message verbatim, no `<details>` wrapper
 * - 2+ messages → intermediate messages inside `<details>`, final message
 *   after it
 *
 * @param messages - Assistant text messages in order, blank ones filtered
 *   out. The last entry is treated as the final output.
 * @returns The composed Markdown body.
 */
export function buildCollapsedBody(messages: string[]): string {
  if (messages.length === 0) {
    return '';
  }
  if (messages.length === 1) {
    return messages[0] ?? '';
  }
  const intermediate = messages.slice(0, -1);
  const final = messages[messages.length - 1] ?? '';
  // The blank line after </summary> is required for the intermediate
  // messages to render as Markdown inside the collapsed block. The <em>
  // tags set the summary apart from the (heavier) expanded content below.
  return (
    '<details>\n<summary><em>Intermediate output</em></summary>\n\n' +
    intermediate.join('\n\n') +
    '\n\n</details>\n\n' +
    final
  );
}
