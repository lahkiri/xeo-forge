/**
 * Context-window accounting — the single, pure source of the runtime context
 * metric. No tracking engine, no hidden state: usage is derived deterministically
 * from the canonical in-memory messages array the agent actually sends to the
 * model. This keeps `context_usage_percentage` real (never fake/hardcoded) and
 * reproducible for tests.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/index';

/**
 * Approximate tokens for a string. We deliberately avoid a tokenizer dependency
 * (provider-specific, heavy) and use the widely-accepted ~4-chars-per-token
 * heuristic, with a small per-message structural overhead added by the caller.
 * This is the "closest reliable runtime equivalent" to true token accounting
 * and is monotonic in message size, which is what threshold logic needs.
 */
export function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Per-message overhead (role tag, delimiters) the chat format adds. */
const PER_MESSAGE_OVERHEAD = 4;

/** Flatten an OpenAI message's content (string or content-parts) to text. */
function messageText(message: ChatCompletionMessageParam): string {
  const parts: string[] = [];
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  // Assistant tool calls carry argument JSON that counts toward context.
  const toolCalls = (message as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> })
    .tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (call.function?.name) parts.push(call.function.name);
      if (call.function?.arguments) parts.push(call.function.arguments);
    }
  }
  return parts.join('\n');
}

/** Estimated tokens for a single chat message, including structural overhead. */
export function estimateMessageTokens(message: ChatCompletionMessageParam): number {
  return PER_MESSAGE_OVERHEAD + estimateTokensForText(messageText(message));
}

/** Estimated tokens for the full messages array sent to the model. */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

export interface ContextUsage {
  used_tokens: number;
  context_window: number;
  /** 0–100, rounded to one decimal. The authoritative usage metric. */
  percentage: number;
}

/**
 * Compute context usage for a messages array against the model's window.
 * Guards against a non-positive window so the metric never divides by zero or
 * goes infinite — failures here would silently corrupt threshold logic.
 */
export function computeContextUsage(
  messages: ChatCompletionMessageParam[],
  contextWindow: number,
): ContextUsage {
  const window = contextWindow > 0 ? contextWindow : 1;
  const used = estimateTokens(messages);
  const percentage = Math.round((used / window) * 1000) / 10;
  return { used_tokens: used, context_window: window, percentage };
}

/**
 * Decide whether compaction should run. Hard threshold = configured percentage;
 * triggers when usage is at or above it. The threshold is clamped to a sane
 * range so a bad admin value can't disable the safety net or thrash.
 */
export function shouldCompact(usagePercentage: number, thresholdPercentage: number): boolean {
  const threshold = clampThreshold(thresholdPercentage);
  return usagePercentage >= threshold;
}

/** Clamp an admin-supplied threshold to [10, 95]; default 80 on bad input. */
export function clampThreshold(thresholdPercentage: number): number {
  if (!Number.isFinite(thresholdPercentage)) return 80;
  return Math.min(95, Math.max(10, Math.round(thresholdPercentage)));
}
