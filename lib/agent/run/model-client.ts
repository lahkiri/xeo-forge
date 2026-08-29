/**
 * Model client — OpenAI-compatible completion requests with classified retry.
 *
 * Extracted from loop.ts (v1.24 structural rework) VERBATIM. The retry loop
 * is deliberate: only rate-limit (non-quota) and network failures retry, per
 * classifyModelError; everything else throws immediately so failRun can
 * surface an honest public error. Behavior is pinned end-to-end by
 * test/run-agent-behavior.test.ts (B5 auth failure is non-retryable).
 */

import type OpenAI from 'openai';
import { classifyModelError, shouldRetryModelError } from '../../model/errors';

/**
 * HTTP timeout for OpenAI-compatible completions. Without this, a hung
 * upstream stream can hold a task in 'running' forever (observed bug: a task
 * stuck running with no events). 5 minutes is generous for long tool-heavy
 * responses while still breaking dead connections.
 */
export const OPENAI_TIMEOUT_MS = 300_000;

const MODEL_MAX_RETRIES = 2;
const MODEL_RETRY_BASE_MS = 1_000;
const MODEL_RETRY_MAX_MS = 30_000;

export async function createCompletionWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  onRetry: (info: { attempt: number; maxRetries: number; delayMs: number; kind: string }) => Promise<void>,
): Promise<any> {
  for (let attempt = 0; attempt <= MODEL_MAX_RETRIES; attempt += 1) {
    try {
      return await client.chat.completions.create(params);
    } catch (error) {
      if (attempt >= MODEL_MAX_RETRIES || !shouldRetryModelError(error)) throw error;
      const info = classifyModelError(error);
      const exponentialDelay = MODEL_RETRY_BASE_MS * (2 ** attempt);
      const requestedDelay = info.retryAfterMs ?? exponentialDelay;
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = Math.min(MODEL_RETRY_MAX_MS, Math.max(500, requestedDelay + jitter));
      await onRetry({ attempt: attempt + 1, maxRetries: MODEL_MAX_RETRIES, delayMs, kind: info.kind });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Model request retry loop ended unexpectedly.');
}
