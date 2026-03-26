import { describe, it, expect } from 'bun:test';
import { PI_TIMEOUT_MS } from './constants.js';

describe('constants', () => {
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
