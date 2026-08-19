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
