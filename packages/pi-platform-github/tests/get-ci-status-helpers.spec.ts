/**
 * Unit tests for `buildCIStatusSummary`, the pure renderer extracted from
 * `getCIStatus` in `packages/pi-platform-github/src/tools/get-ci-status.ts`.
 *
 * `getCIStatus` (the caller) is exercised end-to-end by `get-ci-status.spec.ts`
 * (which has ~30 tests covering ref resolution, check runs, workflow runs,
 * summary formatting, parallel fetch). Here we test the pure renderer
 * directly so the line-emission contract is pinned down independently of
 * the network/ref-resolution code.
 */

import { describe, expect, test } from 'vitest';
import {
  buildCIStatusSummary,
  type CheckRunResult,
  type WorkflowRunResult,
} from '@alexanderfortin/pi-platform-github';

function buildCheckRun(overrides: Partial<CheckRunResult> = {}): CheckRunResult {
  return {
    id: 1,
    name: 'unit-tests',
    status: 'completed',
    conclusion: 'success',
    details_url: 'https://example.com/check/1',
    html_url: null,
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:05:00Z',
    ...overrides,
  };
}

function buildWorkflowRun(overrides: Partial<WorkflowRunResult> = {}): WorkflowRunResult {
  return {
    id: 100,
    name: 'CI',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://example.com/run/100',
    head_branch: 'main',
    head_sha: 'abc1234',
    started_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildCIStatusSummary', () => {
  test('renders only the header + empty-runs message when both arrays are empty', () => {
    const lines = buildCIStatusSummary('abc12345', [], []);
    expect(lines).toEqual([
      'CI Status for abc12345:',
      '',
      'No check runs or workflow runs found for this ref.',
    ]);
  });

  test('header includes the shortRef verbatim', () => {
    const lines = buildCIStatusSummary('deadbeef', [], []);
    expect(lines[0]).toBe('CI Status for deadbeef:');
  });

  test('renders a single check run with conclusion + details_url', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [buildCheckRun({ name: 'lint', conclusion: 'failure', details_url: 'https://lint/1' })],
      []
    );
    expect(lines).toContain('Check Runs (1):');
    // Icon for "completed + failure" is ❌ (per ci-utils.getStatusIcon).
    expect(lines).toContain('  ❌ lint: completed (failure)');
    expect(lines).toContain('     https://lint/1');
  });

  test('omits the details_url line when details_url is null/missing', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [buildCheckRun({ name: 'fast-check', details_url: null })],
      []
    );
    expect(lines.some(l => l.startsWith('     '))).toBe(false);
  });

  test('omits the "(conclusion)" suffix when conclusion is null', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [buildCheckRun({ status: 'in_progress', conclusion: null })],
      []
    );
    expect(lines).toContain('  🔄 unit-tests: in_progress');
    expect(lines.some(l => l.includes('(null)'))).toBe(false);
  });

  test('renders multiple check runs in order', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [
        buildCheckRun({ id: 1, name: 'lint' }),
        buildCheckRun({ id: 2, name: 'test' }),
        buildCheckRun({ id: 3, name: 'build' }),
      ],
      []
    );
    expect(lines).toContain('Check Runs (3):');
    expect(lines.indexOf('  ✅ lint: completed (success)')).toBeLessThan(
      lines.indexOf('  ✅ test: completed (success)')
    );
    expect(lines.indexOf('  ✅ test: completed (success)')).toBeLessThan(
      lines.indexOf('  ✅ build: completed (success)')
    );
  });

  test('renders a single workflow run with id + html_url', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [],
      [buildWorkflowRun({ name: 'Deploy', event: 'workflow_dispatch', html_url: 'https://run/9' })]
    );
    expect(lines).toContain('Workflow Runs (1):');
    expect(lines).toContain('  ✅ Deploy [workflow_dispatch]: completed (success)');
    expect(lines).toContain('     Run ID: 100 · https://run/9');
  });

  test('renders multiple workflow runs in order', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [],
      [
        buildWorkflowRun({ id: 1, name: 'A' }),
        buildWorkflowRun({ id: 2, name: 'B' }),
        buildWorkflowRun({ id: 3, name: 'C' }),
      ]
    );
    expect(lines).toContain('Workflow Runs (3):');
    const idxA = lines.indexOf('  ✅ A [push]: completed (success)');
    const idxB = lines.indexOf('  ✅ B [push]: completed (success)');
    const idxC = lines.indexOf('  ✅ C [push]: completed (success)');
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  test('renders both check runs AND workflow runs when both are present', () => {
    const lines = buildCIStatusSummary('abc12345', [buildCheckRun()], [buildWorkflowRun()]);
    expect(lines).toContain('Check Runs (1):');
    expect(lines).toContain('Workflow Runs (1):');
    // Check runs section comes before workflow runs section.
    expect(lines.indexOf('Check Runs (1):')).toBeLessThan(lines.indexOf('Workflow Runs (1):'));
  });

  test('does NOT render the empty-runs message when at least one run exists', () => {
    const lines = buildCIStatusSummary('abc12345', [buildCheckRun()], []);
    expect(lines).not.toContain('No check runs or workflow runs found for this ref.');
  });

  test('renders queued check runs with the queued icon', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [buildCheckRun({ status: 'queued', conclusion: null })],
      []
    );
    expect(lines).toContain('  ⏳ unit-tests: queued');
  });

  test('renders failed workflow runs with the failure icon', () => {
    const lines = buildCIStatusSummary(
      'abc12345',
      [],
      [buildWorkflowRun({ status: 'completed', conclusion: 'failure' })]
    );
    expect(lines).toContain('  ❌ CI [push]: completed (failure)');
  });

  test('emits blank-line separators between sections', () => {
    const lines = buildCIStatusSummary('abc12345', [buildCheckRun()], [buildWorkflowRun()]);
    // header line, blank, check header, ..., blank, workflow header, ..., blank
    expect(lines[1]).toBe('');
    // The trailing element is the final blank line after the workflow runs block.
    expect(lines[lines.length - 1]).toBe('');
  });
});
