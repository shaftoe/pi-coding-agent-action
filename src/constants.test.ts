import { describe, it, expect } from 'bun:test';
import { DEFAULT_FETCH_DEPTH, PI_TIMEOUT_MS } from './constants.js';

describe('constants', () => {
  describe('DEFAULT_FETCH_DEPTH', () => {
    it('should be a positive number', () => {
      expect(DEFAULT_FETCH_DEPTH).toBeNumber();
      expect(DEFAULT_FETCH_DEPTH).toBeGreaterThan(0);
    });

    it('should equal 20', () => {
      expect(DEFAULT_FETCH_DEPTH).toBe(20);
    });

    it('should ensure we have enough history for PR operations', () => {
      expect(DEFAULT_FETCH_DEPTH).toBeGreaterThanOrEqual(10);
    });
  });

  describe('PI_TIMEOUT_MS', () => {
    it('should be a positive number', () => {
      expect(PI_TIMEOUT_MS).toBeNumber();
      expect(PI_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('should equal 60 minutes in milliseconds', () => {
      const sixtyMinutes = 60 * 60 * 1000;
      expect(PI_TIMEOUT_MS).toBe(sixtyMinutes);
    });

    it('should be at least 30 minutes', () => {
      const thirtyMinutes = 30 * 60 * 1000;
      expect(PI_TIMEOUT_MS).toBeGreaterThanOrEqual(thirtyMinutes);
    });
  });
});
