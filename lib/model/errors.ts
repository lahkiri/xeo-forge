export type ModelErrorKind = 'rate_limit' | 'authentication' | 'not_found' | 'bad_request' | 'network' | 'unknown';

export interface ModelErrorInfo {
  kind: ModelErrorKind;
  status: number | null;
  code: string | null;
  retryAfterMs: number | null;
  quotaExhausted: boolean;
  safeMessage: string;
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Record<string, unknown>;
  const status = Number(candidate.status ?? (candidate.response as Record<string, unknown> | undefined)?.status);
  return Number.isFinite(status) && status > 0 ? status : null;
}

function readCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Record<string, unknown>;
  const response = candidate.response as Record<string, unknown> | undefined;
  const body = response?.data as Record<string, unknown> | undefined;
  const nestedError = body?.error as Record<string, unknown> | undefined;
  const code = candidate.code
    ?? body?.code
    ?? nestedError?.code
    ?? nestedError?.type
    ?? (typeof candidate.name === 'string' && candidate.name !== 'APIError' ? candidate.name : undefined)
    ?? (typeof body?.type === 'string' && body.type !== 'error' ? body.type : undefined)
    ?? body?.error;
  return typeof code === 'string' ? code : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return String((error as Record<string, unknown>).message);
  }
  return String(error || 'Unknown model provider error');
}

function readHeader(error: unknown, name: string): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Record<string, unknown>;
  const headers = candidate.headers ?? (candidate.response as Record<string, unknown> | undefined)?.headers;
  if (!headers) return null;
  if (typeof (headers as { get?: (key: string) => string | null }).get === 'function') {
    return (headers as { get: (key: string) => string | null }).get(name);
  }
  if (typeof headers === 'object') {
    const record = headers as Record<string, unknown>;
    const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  }
  return null;
}

function parseRetryAfterMs(error: unknown): number | null {
  const retryAfterMs = readHeader(error, 'retry-after-ms');
  if (retryAfterMs && /^\d+(\.\d+)?$/.test(retryAfterMs.trim())) {
    return Math.min(60_000, Math.max(0, Math.round(Number(retryAfterMs))));
  }
  const retryAfter = readHeader(error, 'retry-after');
  if (retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim())) {
    return Math.min(60_000, Math.max(0, Math.round(Number(retryAfter) * 1000)));
  }
  return null;
}

function redactMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/(?:sk|key|token|api)[-_][A-Za-z0-9._~-]{8,}/gi, '<redacted-key>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function classifyModelError(error: unknown): ModelErrorInfo {
  const status = readStatus(error);
  const code = readCode(error)?.toLowerCase() || null;
  const message = readMessage(error);
  const lower = message.toLowerCase();

  let kind: ModelErrorKind = 'unknown';
  if (status === 429 || code?.includes('rate_limit') || lower.includes('rate limit') || lower.includes('too many requests')) {
    kind = 'rate_limit';
  } else if (status === 401 || status === 403 || lower.includes('incorrect api key') || lower.includes('invalid api key') || lower.includes('authentication')) {
    kind = 'authentication';
  } else if (status === 404 || lower.includes('model not found') || lower.includes('does not exist')) {
    kind = 'not_found';
  } else if (status === 400 || lower.includes('invalid request') || lower.includes('invalid parameter')) {
    kind = 'bad_request';
  } else if (code === 'enotfound' || code === 'econnrefused' || code === 'etimedout' || lower.includes('fetch failed') || lower.includes('timeout')) {
    kind = 'network';
  }

  const quotaExhausted = Boolean(
    code?.includes('freeusagelimit')
      || code?.includes('insufficient_quota')
      || lower.includes('free usage limit')
      || lower.includes('freeusagelimiterror')
      || lower.includes('completion quota')
      || lower.includes('quota exceeded'),
  );
  const safeMessage = redactMessage(message);
  return {
    kind,
    status,
    code,
    retryAfterMs: parseRetryAfterMs(error),
    quotaExhausted,
    safeMessage,
  };
}

export function publicModelErrorMessage(error: unknown, operation = 'model request', baseUrl = ''): string {
  const info = classifyModelError(error);
  const waitHint = info.retryAfterMs !== null
    ? ` The provider asked Xeo to wait about ${Math.max(1, Math.ceil(info.retryAfterMs / 1000))} seconds.`
    : '';
  const isOpenCodeZen = baseUrl.toLowerCase().includes('opencode.ai/zen');
  const freeModelHint = isOpenCodeZen
    ? ' Try another available Zen model such as `mimo-v2.5-free` or `hy3-free`, or wait for the free window to reset.'
    : ' Wait for the provider window to reset or choose a model/provider with available quota.';
  switch (info.kind) {
    case 'rate_limit':
      if (info.quotaExhausted) {
        return `The provider accepted the connection but this model's free completion quota is exhausted (HTTP 429). Your key may still be valid; this is an upstream model quota, not a connection failure.${freeModelHint}`;
      }
      return `The provider accepted the connection but rate-limited this completion (HTTP 429). Your key may still be valid; Xeo retries with controlled backoff.${waitHint}${freeModelHint}`;
    case 'authentication':
      return 'The model provider rejected the API key (HTTP 401/403). Open Settings → Local model and replace any placeholder or expired key.';
    case 'not_found':
      return `The provider could not find model "${operation}". Check the Model ID and base URL in Settings → Local model.`;
    case 'bad_request':
      return `The provider rejected this ${operation}. Check the model ID, base URL, and token limits in Settings → Local model.`;
    case 'network':
      return 'Xeo could not reach the model provider. Check the base URL, local server, and network connection.';
    default:
      return info.safeMessage || `The ${operation} failed. Check Settings → Local model and try again.`;
  }
}

export function shouldRetryModelError(error: unknown): boolean {
  const info = classifyModelError(error);
  return (info.kind === 'rate_limit' && !info.quotaExhausted) || info.kind === 'network';
}
