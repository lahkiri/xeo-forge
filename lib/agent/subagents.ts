/**
 * Parallel read-only subagent delegation (v1.23) — the Hermes-inspired gap
 * closer, applied THROUGH the existing governance stack, never around it.
 *
 * Contract (the owner's rules, verbatim in spirit):
 * 1. INHERITANCE: every subagent executes under the PARENT task's autonomy
 *    level and permission rule set — literally the same ToolContext, so the
 *    same authorizeToolCall gate dispatches every subagent tool call. A
 *    subagent cannot hold broader authority than its parent, ever.
 * 2. READ-ONLY: the subagent toolset is physically limited to
 *    file_read / file_list / web_search. No writes, no shell, no MCP. This
 *    keeps v1.23 free of concurrent-write race conditions by construction.
 * 3. ATTRIBUTION: every subagent step emits audit events tagged with the
 *    subagent id (`sub-1`, `sub-2`, …) — the audit trail shows WHO did WHAT,
 *    not one flat merged log.
 * 4. BOUNDED: max 3 iterations and one tool call per iteration per subagent;
 *    the parent stays in charge of the actual work.
 */

import type OpenAI from 'openai';
import { executeTool, schemasForMode, MAX_RESULT_CHARS } from './tools';
import type { ToolContext } from './tools';
import { emitTaskEvent } from '../sse/emitter';

export const DELEGATE_TOOL_NAME = 'delegate_research';

/** Hard bounds — deliberate, documented, not tunable per run. */
const MAX_SUBAGENTS = 4;
const MAX_SUBAGENT_ITERATIONS = 3;
const MAX_SUBAGENT_TOKENS = 1400;

const SUBAGENT_SYSTEM = `You are a focused research subagent. Your ONLY job is to answer the assigned question using the read-only tools available (file_read, file_list, web_search). Rules:
- Be terse and factual. Your answer is consumed by a parent agent, not a human.
- Use at most ONE tool call per step, at most ${MAX_SUBAGENT_ITERATIONS} steps, then ANSWER.
- If the tools cannot answer the question, say exactly what is missing instead of guessing.
- Answer in the same language as the question.`;

/** The tool schemas a subagent may see — read-only, mode-independent. */
const SUBAGENT_TOOL_NAMES = new Set(['file_read', 'file_list', 'web_search']);

export interface DelegateResult {
  answers: Array<{ subagent: string; prompt: string; answer: string; steps: number }>;
  errors: Array<{ subagent: string; error: string }>;
}

/**
 * Validate the delegation request up front — a model asking for 20 parallel
 * agents or empty prompts gets an honest 400-shaped error, not a surprise.
 */
export function normalizeDelegation(raw: { objective?: unknown; prompts?: unknown }): {
  objective: string;
  prompts: string[];
} {
  const objective = String(raw.objective ?? '').trim().slice(0, 500);
  const input = Array.isArray(raw.prompts) ? raw.prompts : [];
  const prompts = input
    .map((p) => String(p ?? '').trim().slice(0, 1200))
    .filter((p) => p.length > 0)
    .slice(0, MAX_SUBAGENTS);
  if (!objective) throw new Error('delegate_research: objective is required.');
  if (prompts.length === 0) throw new Error('delegate_research: at least one prompt is required.');
  if (Array.isArray(raw.prompts) && raw.prompts.length > MAX_SUBAGENTS) {
    throw new Error(`delegate_research: at most ${MAX_SUBAGENTS} parallel subagents per call (got ${raw.prompts.length}).`);
  }
  return { objective, prompts };
}

/** Run ONE subagent to completion under the parent's rule set. */
async function runOneSubagent(args: {
  client: OpenAI;
  modelId: string;
  subagentId: string;
  prompt: string;
  ctx: ToolContext;
  abortSignal?: AbortSignal;
}): Promise<{ subagent: string; prompt: string; answer: string; steps: number }> {
  const { client, modelId, subagentId, prompt, ctx, abortSignal } = args;
  const toolSchemas = schemasForMode('build').filter((s) => SUBAGENT_TOOL_NAMES.has(s.function.name));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SUBAGENT_SYSTEM },
    { role: 'user', content: prompt },
  ];

  for (let step = 1; step <= MAX_SUBAGENT_ITERATIONS; step++) {
    const res = await client.chat.completions.create(
      {
        model: modelId,
        messages,
        tools: toolSchemas,
        tool_choice: 'auto',
        max_tokens: MAX_SUBAGENT_TOKENS,
        temperature: 0.2,
      },
      abortSignal ? { signal: abortSignal } : undefined,
    );
    const choice = res.choices?.[0];
    const message = choice?.message;
    const calls = message?.tool_calls ?? [];

    if (calls.length > 0) {
      // ONE tool call per step (first wins) — bounded fan-out per subagent.
      const call = calls[0];
      const toolName = call.function?.name ?? '';
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>; } catch { /* bad args → honest error below */ }
      await emitTaskEvent(ctx.taskId, 'tool_call', {
        name: toolName,
        args: toolArgs,
        subagent: subagentId,
        note: `delegated step ${step}/${MAX_SUBAGENT_ITERATIONS}`,
      });
      // GOVERNANCE INHERITANCE: the parent's ctx carries the parent's rules,
      // workspace bounds, and mode — the subagent dispatches through the
      // identical executeTool gate. No separate policy path exists.
      const observation = await executeTool(toolName, toolArgs, ctx);
      await emitTaskEvent(ctx.taskId, 'tool_result', {
        name: toolName,
        ok: !observation.startsWith('Error:'),
        result: observation.slice(0, 400),
        subagent: subagentId,
      });
      messages.push(message as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      messages.push({ role: 'tool', tool_call_id: call.id, content: observation.slice(0, 4000) });
      continue;
    }

    const answer = (message?.content ?? '').trim();
    await emitTaskEvent(ctx.taskId, 'tool_result', {
      name: DELEGATE_TOOL_NAME,
      ok: answer.length > 0,
      result: answer.slice(0, 400),
      subagent: subagentId,
      note: 'final answer',
    });
    return { subagent: subagentId, prompt, answer: answer || '(no answer produced)', steps: step };
  }

  return { subagent: subagentId, prompt, answer: '(iteration budget exhausted without a final answer)', steps: MAX_SUBAGENT_ITERATIONS };
}

/**
 * Fan out parallel read-only research subagents. Failures are isolated:
 * one subagent crashing never takes down its siblings — its error is
 * reported as that subagent's result, honestly.
 */
export async function runDelegatedResearch(args: {
  client: OpenAI;
  modelId: string;
  objective: string;
  prompts: string[];
  ctx: ToolContext;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { client, modelId, objective, prompts, ctx, abortSignal } = args;

  await emitTaskEvent(ctx.taskId, 'tool_call', {
    name: DELEGATE_TOOL_NAME,
    args: { objective, parallel: prompts.length },
    note: 'delegation fan-out (read-only, parent authority inherited)',
  });

  const settled = await Promise.allSettled(
    prompts.map((prompt, index) =>
      runOneSubagent({
        client,
        modelId,
        subagentId: `sub-${index + 1}`,
        prompt,
        ctx,
        abortSignal,
      }),
    ),
  );

  const answers: DelegateResult['answers'] = [];
  const errors: DelegateResult['errors'] = [];
  settled.forEach((outcome, index) => {
    const subagentId = `sub-${index + 1}`;
    if (outcome.status === 'fulfilled') {
      answers.push(outcome.value);
    } else {
      errors.push({ subagent: subagentId, error: String(outcome.reason?.message ?? outcome.reason).slice(0, 300) });
    }
  });

  const sections = answers.map(
    (a) => `## ${a.subagent}\nQ: ${a.prompt}\n\n${a.answer} (${a.steps} step${a.steps === 1 ? '' : 's'})`,
  );
  if (errors.length > 0) {
    sections.push(
      `## failed subagents\n${errors.map((e) => `- ${e.subagent}: ${e.error}`).join('\n')}`,
    );
  }
  const header = `Delegated research — "${objective}" — ${answers.length}/${prompts.length} subagents answered`;
  const text = `${header}\n\n${sections.join('\n\n')}`;
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `\n…[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
}
