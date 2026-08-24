import { describe, expect, it } from 'vitest';
import { classifyModelError, publicModelErrorMessage, shouldRetryModelError } from '../lib/model/errors';

describe('model provider errors', () => {
  it('classifies HTTP 429 and respects retry-after-ms', () => {
    const error = {
      status: 429,
      message: 'Too many requests',
      headers: new Headers({ 'retry-after-ms': '1500' }),
    };
    const info = classifyModelError(error);
    expect(info.kind).toBe('rate_limit');
    expect(info.status).toBe(429);
    expect(info.retryAfterMs).toBe(1500);
    expect(shouldRetryModelError(error)).toBe(true);
    expect(publicModelErrorMessage(error)).toContain('HTTP 429');
    expect(publicModelErrorMessage(error)).toContain('about 2 seconds');
  });

  it('stops retrying an exhausted OpenCode free-model quota and suggests alternatives', () => {
    const error = {
      status: 429,
      message: 'Error from provider (Console): Rate limit exceeded. Please try again later.',
      response: {
        status: 429,
        data: { type: 'error', error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded' } },
      },
    };
    const info = classifyModelError(error);
    expect(info.kind).toBe('rate_limit');
    expect(info.quotaExhausted).toBe(true);
    expect(shouldRetryModelError(error)).toBe(false);
    const message = publicModelErrorMessage(error, 'deepseek-v4-flash-free', 'https://opencode.ai/zen/v1');
    expect(message).toContain("free completion quota is exhausted");
    expect(message).toContain('mimo-v2.5-free');
  });

  it('detects nested OpenCode free quota codes and stops retrying', () => {
    const error = {
      name: 'APIError',
      status: 429,
      message: 'The provider rate-limited this completion.',
      response: {
        status: 429,
        data: { error: { code: 'FreeUsageLimitError', message: 'free usage limit reached' } },
      },
    };
    const info = classifyModelError(error);
    expect(info.quotaExhausted).toBe(true);
    expect(shouldRetryModelError(error)).toBe(false);
    expect(publicModelErrorMessage(error, 'deepseek-v4-flash-free', 'https://opencode.ai/zen/v1')).toContain('free completion quota is exhausted');
  });

  it('classifies invalid provider keys as authentication errors without retrying', () => {
    const error = { status: 401, message: 'Incorrect API key provided' };
    const info = classifyModelError(error);
    expect(info.kind).toBe('authentication');
    expect(shouldRetryModelError(error)).toBe(false);
    expect(publicModelErrorMessage(error)).toContain('API key');
  });

  it('classifies connection failures as retryable network errors', () => {
    const error = { code: 'ECONNREFUSED', message: 'fetch failed' };
    expect(classifyModelError(error).kind).toBe('network');
    expect(shouldRetryModelError(error)).toBe(true);
  });
});
