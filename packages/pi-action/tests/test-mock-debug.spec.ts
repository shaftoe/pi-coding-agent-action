import { describe, expect, test, beforeEach } from 'bun:test';
import { coreMock, registerCoreMock } from '../../pi-orchestrator/tests/helpers/core-mock';

registerCoreMock();

describe('mock debug', () => {
  beforeEach(() => {
    coreMock.getInput.mockClear();
    coreMock.debug.mockClear();
    coreMock.getInput.mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'test-token',
        thinking_level: '',
        prompt: '',
      };
      return defaults[name] ?? '';
    });
  });

  test('test 1 - get provider', () => {
    expect(coreMock.getInput('provider')).toBe('anthropic');
  });

  test('test 2 - override and check', () => {
    coreMock.getInput.mockImplementation((name: string) => {
      if (name === 'model') {
        return '';
      }
      return 'value';
    });
    expect(coreMock.getInput('provider')).toBe('value');
    expect(coreMock.getInput('model')).toBe('');
  });

  test('test 3 - should be back to defaults', () => {
    expect(coreMock.getInput('provider')).toBe('anthropic');
    expect(coreMock.getInput('model')).toBe('claude-sonnet-4-5');
  });
});
