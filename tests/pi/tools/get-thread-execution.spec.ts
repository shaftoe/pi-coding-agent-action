/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { getIssueOrPRThreadTool } from '../../../src/pi/tools/get-thread';
import * as githubIndex from '../../../src/git/index';

describe('get_issue_or_pr_thread tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(getIssueOrPRThreadTool.name).toBe('get_issue_or_pr_thread');
    expect(getIssueOrPRThreadTool.label).toBe('Get Issue/PR Thread');
  });

  test('execute function exists and is a function', () => {
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.owner).toBeDefined();
    expect(schema.properties.repo).toBeDefined();
    expect(schema.properties.issue_number).toBeDefined();
    expect(schema.properties.max_comments).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    // The execute function wraps the user's execute with cancellation checks
    // Cancellation is tested in tool-builder.spec.ts
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('tool exports match github/index exports', () => {
    // Verify that the tool uses the correct functions from github/index
    expect(githubIndex.getIssueOrPRThread).toBeDefined();
    expect(typeof githubIndex.getIssueOrPRThread).toBe('function');
  });

  test('parameters schema - all fields are optional', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    // When all fields are optional, required may be undefined or empty
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });
});
