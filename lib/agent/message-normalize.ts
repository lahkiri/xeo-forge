import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Some OpenAI-compatible reasoning models require the provider-emitted
 * reasoning_content to be replayed alongside an assistant tool call. The
 * field is intentionally added only when the upstream actually sent it, so
 * ordinary providers keep receiving the standard OpenAI message shape.
 */
export function attachAssistantReasoning<T extends ChatCompletionMessageParam>(
  message: T,
  reasoningContent: string,
): T {
  const value = reasoningContent.trim();
  if (!value) return message;
  return { ...message, reasoning_content: value } as unknown as T;
}
