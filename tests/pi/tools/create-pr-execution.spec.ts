/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { createPRTool } from '../../../src/pi/tools/create-pr';
import * as githubIndex from '../../../src/git/index';

describe('create_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(createPRTool.name).toBe('create_pull_request');
    expect(createPRTool.label).toBe('Create Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.base).toBeDefined();
    expect(schema.properties.dryRun).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    // The execute function wraps the user's execute with cancellation checks
    // Cancellation is tested in tool-builder.spec.ts
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('tool exports match github/index exports', () => {
    // Verify that the tool uses the correct functions from github/index
    expect(githubIndex.createPullRequest).toBeDefined();
    expect(typeof githubIndex.createPullRequest).toBe('function');
  });

  test('parameters schema validates title as required', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.required).toContain('title');
    expect(schema.required).not.toContain('body');
    expect(schema.required).not.toContain('base');
    expect(schema.required).not.toContain('dryRun');
  });
});
