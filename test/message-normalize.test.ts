import { describe, expect, it } from 'vitest';
import { attachAssistantReasoning } from '../lib/agent/message-normalize';

describe('assistant message normalization', () => {
  const message = {
    role: 'assistant' as const,
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'task_complete', arguments: '{"summary":"done"}' },
      },
    ],
  };

  it('does not add provider-specific reasoning when none was emitted', () => {
    const normalized = attachAssistantReasoning(message, '   ') as unknown as Record<string, unknown>;

    expect(normalized).toEqual(message);
    expect(normalized).not.toHaveProperty('reasoning_content');
  });

  it('preserves tool calls and attaches streamed reasoning when present', () => {
    const normalized = attachAssistantReasoning(message, '  internal reasoning  ') as unknown as Record<string, unknown>;

    expect(normalized).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: message.tool_calls,
      reasoning_content: 'internal reasoning',
    });
  });
});
