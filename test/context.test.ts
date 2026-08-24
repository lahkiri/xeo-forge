import { describe, it, expect } from 'vitest';
import {
  estimateTokensForText,
  estimateMessageTokens,
  estimateTokens,
  computeContextUsage,
  shouldCompact,
  clampThreshold,
} from '../lib/agent/context';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/* ------------------------------------------------------------------ */
/* Token estimation                                                    */
/* ------------------------------------------------------------------ */

describe('estimateTokensForText', () => {
  it('returns 0 for empty/null', () => {
    expect(estimateTokensForText('')).toBe(0);
  });

  it('approximates ~4 chars per token', () => {
    // "hello" = 5 chars → ceil(5/4) = 2 tokens
    expect(estimateTokensForText('hello')).toBe(2);
    // 8 chars → 2 tokens
    expect(estimateTokensForText('12345678')).toBe(2);
    // 9 chars → ceil(9/4) = 3 tokens
    expect(estimateTokensForText('123456789')).toBe(3);
  });

  it('scales linearly', () => {
    const short = estimateTokensForText('abc');
    const long = estimateTokensForText('a'.repeat(400));
    expect(long).toBeGreaterThan(short);
    expect(long).toBe(100); // 400/4
  });
});

describe('estimateMessageTokens', () => {
  it('adds per-message overhead', () => {
    const textOnly = estimateTokensForText('hello');
    const msg: ChatCompletionMessageParam = { role: 'user', content: 'hello' };
    const msgTokens = estimateMessageTokens(msg);
    // Should be textOnly + PER_MESSAGE_OVERHEAD (4)
    expect(msgTokens).toBe(textOnly + 4);
  });

  it('handles tool calls with arguments', () => {
    const msg: ChatCompletionMessageParam = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'file_read', arguments: '{"path":"src/main.ts"}' },
        },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    // Should include function name + arguments
    expect(tokens).toBeGreaterThan(4); // at least overhead
  });

  it('handles array content (multimodal)', () => {
    const msg: ChatCompletionMessageParam = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(4);
  });
});

describe('estimateTokens', () => {
  it('sums all messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const total = estimateTokens(messages);
    const individual = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    expect(total).toBe(individual);
  });

  it('returns 0 for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Context usage computation                                           */
/* ------------------------------------------------------------------ */

describe('computeContextUsage', () => {
  it('computes percentage correctly', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'a'.repeat(1000) }, // ~250 tokens + 4 overhead = 254
    ];
    const usage = computeContextUsage(messages, 1000);
    // 254/1000 * 100 = 25.4%
    expect(usage.percentage).toBe(25.4);
    expect(usage.context_window).toBe(1000);
    expect(usage.used_tokens).toBe(254);
  });

  it('handles zero context window gracefully', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'test' },
    ];
    const usage = computeContextUsage(messages, 0);
    // window defaults to 1, so percentage will be very high
    expect(usage.percentage).toBeGreaterThan(0);
    expect(usage.context_window).toBe(1);
  });

  it('rounds percentage to one decimal', () => {
    // 1 message: 1 char text = 1 token + 4 overhead = 5 tokens
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'x' },
    ];
    const usage = computeContextUsage(messages, 100);
    // 5/100 * 100 = 5.0
    expect(usage.percentage).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* Threshold logic                                                     */
/* ------------------------------------------------------------------ */

describe('clampThreshold', () => {
  it('clamps to [10, 95]', () => {
    expect(clampThreshold(50)).toBe(50);
    expect(clampThreshold(5)).toBe(10);
    expect(clampThreshold(100)).toBe(95);
    expect(clampThreshold(-10)).toBe(10);
  });

  it('defaults to 80 for non-finite', () => {
    expect(clampThreshold(NaN)).toBe(80);
    expect(clampThreshold(Infinity)).toBe(80);
  });
});

describe('shouldCompact', () => {
  it('returns true when usage >= threshold', () => {
    expect(shouldCompact(80, 80)).toBe(true);
    expect(shouldCompact(90, 80)).toBe(true);
    expect(shouldCompact(100, 80)).toBe(true);
  });

  it('returns false when usage < threshold', () => {
    expect(shouldCompact(70, 80)).toBe(false);
    expect(shouldCompact(50, 80)).toBe(false);
  });

  it('handles edge cases with clamped threshold', () => {
    // threshold of 5 gets clamped to 10
    expect(shouldCompact(10, 5)).toBe(true);
    expect(shouldCompact(9, 5)).toBe(false);
  });
});
