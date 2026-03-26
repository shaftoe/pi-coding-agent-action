import { describe, it, expect } from 'bun:test';
import { runPi as _runPi, summarize } from './pi.js';

describe('pi', () => {
  describe('summarize', () => {
    it('should use first line if exactly 50 characters', () => {
      const fiftyCharLine = 'x'.repeat(50);
      const summary = summarize(`${fiftyCharLine}\nMore text`, 123);
      expect(summary).toBe(fiftyCharLine);
    });

    it('should not use first line if over 50 characters', () => {
      const fiftyOneCharLine = 'x'.repeat(51);
      const summary = summarize(`${fiftyOneCharLine}\nMore text`, 123);
      expect(summary).not.toBe(fiftyOneCharLine);
      expect(summary.length).toBeLessThanOrEqual(50);
    });

    it('should not use generic first lines', () => {
      const summary = summarize('I will help you with that', 123);
      expect(summary).not.toBe('I will help you with that');
    });

    it('should reject "Great" as generic', () => {
      const summary = summarize('Great question!', 123);
      expect(summary).not.toContain('Great');
    });

    it('should reject "Here" as generic', () => {
      const summary = summarize('Here is the solution', 123);
      expect(summary).not.toContain('Here');
    });

    it('should reject "The" as generic', () => {
      const summary = summarize('The solution is simple', 123);
      expect(summary).not.toContain('The');
    });

    it('should reject "This" as generic', () => {
      const summary = summarize('This fixes the bug', 123);
      expect(summary).not.toContain('This');
    });

    it('should reject "A" as generic', () => {
      const summary = summarize('A better approach is needed', 123);
      expect(summary).not.toContain('A');
    });

    it('should use first sentence if first line is too long', () => {
      const summary = summarize(
        'This is a very long first line that exceeds fifty characters. But this is shorter.',
        123
      );
      expect(summary.length).toBeLessThanOrEqual(50);
      expect(summary).toContain('very long first line');
    });

    it('should truncate first sentence to 50 characters', () => {
      const longSentence = 'a'.repeat(100);
      const summary = summarize(`${longSentence}. More text.`, 123);
      expect(summary).toBe('a'.repeat(50));
    });

    it('should fallback to generic message for empty text', () => {
      const summary = summarize('', 123);
      expect(summary).toBe('Fix issue #123');
    });

    it('should handle multiline text with first short line', () => {
      const summary = summarize('Fixed memory leak\n\nDetails here', 123);
      expect(summary).toBe('Fixed memory leak');
    });

    it('should handle text with only one long line', () => {
      const longLine = 'x'.repeat(100);
      const summary = summarize(longLine, 123);
      expect(summary).toBe('x'.repeat(50));
    });

    it('should trim whitespace from summary', () => {
      const summary = summarize('  Fixed bug  ', 123);
      expect(summary).toBe('Fixed bug');
    });

    it('should handle first line with leading/trailing spaces', () => {
      const shortLine = '  Fix  ';
      const summary = summarize(`${shortLine}\nMore text`, 123);
      expect(summary).toBe('Fix');
    });
  });
});
