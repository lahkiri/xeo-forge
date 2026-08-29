/**
 * Engineering-memory persistence — the learning half of task completion.
 *
 * Extracted from loop.ts (v1.24 structural rework) VERBATIM. Two invariants
 * travel with the code:
 *   1. sanitizeMemoryCandidates is the prompt-injection wall: secret-shaped
 *      and instruction-shaped content never becomes a memory, whatever the
 *      model asked for.
 *   2. persistMemoryCandidates runs for BUILD mode only — planning describes
 *      future work and must not teach the persistent agent.
 */

import type { AgentMemoryKind, AgentMemoryScope, TaskMode } from '../../types';
import { createAgentMemory } from '../../db/queries';
import { emitTaskEvent } from '../../sse/emitter';

export type MemoryCandidate = {
  content: string;
  kind: AgentMemoryKind;
  scope: AgentMemoryScope;
  confidence: number;
};

export function sanitizeMemoryCandidates(raw: unknown): MemoryCandidate[] {
  if (!Array.isArray(raw)) return [];
  const allowedKinds = new Set<AgentMemoryKind>(['preference', 'fact', 'decision', 'constraint', 'lesson']);
  const allowedScopes = new Set<AgentMemoryScope>(['global', 'task']);
  const secretPattern = /(api[_ -]?key|password|passwd|secret|token|private key|authorization:)/i;
  const instructionPattern = /(ignore (all|previous)|system prompt|developer message|bypass|disable safety|grant permission)/i;
  const result: MemoryCandidate[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const content = typeof candidate.content === 'string'
      ? candidate.content.trim().replace(/\s+/g, ' ').slice(0, 1200)
      : '';
    const kind = candidate.kind;
    const scope = candidate.scope;
    const confidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0.5;
    if (!content || !allowedKinds.has(kind as AgentMemoryKind) || !allowedScopes.has(scope as AgentMemoryScope)) continue;
    if (secretPattern.test(content) || instructionPattern.test(content)) continue;
    result.push({
      content,
      kind: kind as AgentMemoryKind,
      scope: scope as AgentMemoryScope,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }
  return result;
}

export async function persistMemoryCandidates(
  userId: string,
  taskId: string,
  mode: TaskMode,
  raw: unknown,
): Promise<number> {
  // Planning describes future work, so it must not teach the persistent agent.
  if (mode !== 'build') return 0;
  let saved = 0;
  for (const candidate of sanitizeMemoryCandidates(raw)) {
    try {
      const memory = await createAgentMemory({
        userId,
        taskId: candidate.scope === 'task' ? taskId : null,
        scope: candidate.scope,
        kind: candidate.kind,
        content: candidate.content,
        status: 'proposed',
        confidence: candidate.confidence,
        sourceTaskId: taskId,
      });
      await emitTaskEvent(taskId, 'memory', {
        memory_id: memory.id,
        status: memory.status,
        scope: memory.scope,
        kind: memory.kind,
        content: memory.content,
      });
      saved += 1;
    } catch (err) {
      // Learning is supplementary; a persistence failure must never turn a
      // verified software task into a failed task.
      console.error(`[agent] memory proposal failed task=${taskId}:`, err);
    }
  }
  return saved;
}

/**
 * Normalize text for duplicate comparison: collapse whitespace, drop to
 * lowercase. Deliberately crude — the goal is catching the observed Opus-5
 * pattern (the task_complete summary restating the answer the user just
 * read), not forensic similarity.
 */
export function normalizeForDuplicate(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
