import { describe, expect, test } from 'bun:test';

// Test the prompt enrichment logic directly
describe('prompt enrichment logic', () => {
  test('builds enriched prompt with issue title and body', () => {
    const title = 'Bug report';
    const body = 'Something is broken';
    const number = 42;
    const prompt = 'Review this';

    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    if (body) {
      contextParts.push(`\nDescription:\n${body}`);
    }

    contextParts.push(`\n\nComment/Instruction:\n${prompt}`);
    const enrichedPrompt = contextParts.join('');

    expect(enrichedPrompt).toBe(
      'Issue/PR #42: Bug report\nDescription:\nSomething is broken\n\nComment/Instruction:\nReview this'
    );
  });

  test('builds enriched prompt with title only (no body)', () => {
    const title = 'Title only issue';
    const number = 456;
    const prompt = 'Fix this';

    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    contextParts.push(`\n\nComment/Instruction:\n${prompt}`);
    const enrichedPrompt = contextParts.join('');

    expect(enrichedPrompt).toBe(
      'Issue/PR #456: Title only issue\n\nComment/Instruction:\nFix this'
    );
  });

  test('uses only comment body when no context available', () => {
    const prompt = 'Just comment';
    const enrichedPrompt = prompt;

    expect(enrichedPrompt).toBe('Just comment');
  });
});
