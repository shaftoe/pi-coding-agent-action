/**
 * @file Tests for shared CI/CD utility functions.
 */

import { describe, expect, test } from 'bun:test';
import { getStatusIcon } from '@alexanderfortin/pi-platform-github';

describe('getStatusIcon', () => {
  describe('completed status', () => {
    test('returns ✅ for success conclusion', () => {
      expect(getStatusIcon('completed', 'success')).toBe('✅');
    });

    test('returns ❌ for failure conclusion', () => {
      expect(getStatusIcon('completed', 'failure')).toBe('❌');
    });

    test('returns ⛔ for cancelled conclusion', () => {
      expect(getStatusIcon('completed', 'cancelled')).toBe('⛔');
    });

    test('returns ⚠️ for timed_out conclusion', () => {
      expect(getStatusIcon('completed', 'timed_out')).toBe('⚠️');
    });

    test('returns ⚠️ for action_required conclusion', () => {
      expect(getStatusIcon('completed', 'action_required')).toBe('⚠️');
    });

    test('returns ⚠️ for neutral conclusion', () => {
      expect(getStatusIcon('completed', 'neutral')).toBe('⚠️');
    });

    test('returns ⚠️ for null conclusion', () => {
      expect(getStatusIcon('completed', null)).toBe('⚠️');
    });

    test('returns ⚠️ for undefined conclusion', () => {
      expect(getStatusIcon('completed', undefined)).toBe('⚠️');
    });

    test('returns ⚠️ for empty string conclusion', () => {
      expect(getStatusIcon('completed', '')).toBe('⚠️');
    });
  });

  describe('in_progress status', () => {
    test('returns 🔄 for in_progress with null conclusion', () => {
      expect(getStatusIcon('in_progress', null)).toBe('🔄');
    });

    test('returns 🔄 for in_progress with undefined conclusion', () => {
      expect(getStatusIcon('in_progress', undefined)).toBe('🔄');
    });

    test('returns 🔄 for in_progress regardless of conclusion', () => {
      // Even if a conclusion is somehow set, in_progress takes precedence
      expect(getStatusIcon('in_progress', 'success')).toBe('🔄');
    });
  });

  describe('queued and other statuses', () => {
    test('returns ⏳ for queued status', () => {
      expect(getStatusIcon('queued', null)).toBe('⏳');
    });

    test('returns ⏳ for waiting status', () => {
      expect(getStatusIcon('waiting', null)).toBe('⏳');
    });

    test('returns ⏳ for pending status', () => {
      expect(getStatusIcon('pending', null)).toBe('⏳');
    });

    test('returns ⏳ for requested status', () => {
      expect(getStatusIcon('requested', null)).toBe('⏳');
    });

    test('returns ⏳ for unknown status string', () => {
      expect(getStatusIcon('unknown_status', null)).toBe('⏳');
    });

    test('returns ⏳ for empty string status', () => {
      expect(getStatusIcon('', null)).toBe('⏳');
    });
  });

  describe('null and undefined status', () => {
    test('returns ⏳ for null status', () => {
      expect(getStatusIcon(null, null)).toBe('⏳');
    });

    test('returns ⏳ for undefined status', () => {
      expect(getStatusIcon(undefined, undefined)).toBe('⏳');
    });
  });
});
