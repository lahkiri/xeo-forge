/**
 * Compaction — LLM-based conversation summarization for context management.
 *
 * When the context window fills up, older messages are archived (active=0)
 * and replaced with a single system summary (active=1). The summary
 * preserves critical facts, user intent, execution state, and plan/mode
 * awareness — but drops tool-call noise and intermediate observations.
 *
 * This is the single compaction entry point. It is called by the agent loop
 * when the context usage exceeds the admin-configured threshold.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { resolveModel } from '../model/config';
import { COMPACTION_PROMPT } from './prompts';

/**
 * Summarize a conversation segment into a single system message.
 *
 * @param messages - The messages to summarize (already formatted for the LLM).
 * @param summaryPrefix - Optional prefix (e.g. "Context summary from prior conversation:").
 * @returns The summary text, or null if the model call fails.
 */
export async function summarizeMessages(
  messages: ChatCompletionMessageParam[],
  summaryPrefix?: string,
): Promise<string | null> {
  const model = await resolveModel();
  if (!model) return null;

  const client = new OpenAI({
    apiKey: model.apiKey,
    baseURL: model.baseUrl,
    timeout: 300_000,
  });

  const conversationText = messages
    .map((m) => {
      const role = m.role;
      const content = typeof m.content === 'string' ? m.content : '';
      return `[${role}]: ${content}`;
    })
    .join('\n\n');

  const prompt: ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPACTION_PROMPT },
    { role: 'user', content: conversationText },
  ];

  try {
    const res = await client.chat.completions.create({
      model: model.modelId,
      messages: prompt,
      temperature: 0.3,
      max_tokens: 1024,
    });

    const content = res.choices?.[0]?.message?.content;
    if (!content || !content.trim()) return null;

    const summary = summaryPrefix
      ? `${summaryPrefix}\n\n${content.trim()}`
      : content.trim();

    return summary;
  } catch (err) {
    console.error('[compaction] LLM summarization failed:', err);
    return null;
  }
}
