import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, normalizeMaxTokens } from '../lib/model/config';

describe('model configuration normalization', () => {
  it('removes trailing slashes from an OpenAI-compatible base URL', () => {
    expect(normalizeBaseUrl(' https://opencode.ai/zen/v1/// ')).toBe('https://opencode.ai/zen/v1');
  });

  it('raises unusably small output limits to a safe agent minimum', () => {
    expect(normalizeMaxTokens(1)).toBe(256);
    expect(normalizeMaxTokens(128)).toBe(256);
    expect(normalizeMaxTokens(4000)).toBe(4000);
  });

  it('handles invalid and extreme output limits safely', () => {
    expect(normalizeMaxTokens(Number.NaN)).toBe(4000);
    expect(normalizeMaxTokens(999999)).toBe(200000);
  });
});
