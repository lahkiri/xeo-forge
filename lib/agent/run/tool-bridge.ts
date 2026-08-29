/**
 * Tool bridge — the loop's only path into tool execution.
 *
 * Extracted from loop.ts (v1.24 structural rework) VERBATIM. Contracts that
 * travel with the code:
 *   - safeExecute emits the tool_result event on BOTH outcomes (the audit
 *     stream must never contain a tool_call without a terminal observation).
 *   - executeReadSilently is its silent twin for parallel batches, which
 *     emit results in deterministic call order AFTER the whole batch.
 *   - Error text is sanitized (paths/errno → placeholders, 500-char cap)
 *     before it can reach the model or the user.
 *   - isParallelSafeRead is a strict whitelist: file_read/file_list plus the
 *     git READ ops only. Everything else — writes, http, browser, MCP —
 *     stays sequential.
 * Source contracts: test/loop-guards.test.ts (parallel batch describe), with
 * the definitions pinned HERE and call sites pinned in loop.ts.
 */

import { emitTaskEvent } from '../../sse/emitter';
import { createToolContext, executeTool } from '../tools';
import { authorizeToolCall } from '../authority';
import { GIT_READ_OPS, isGitOp } from '../git';
import type { PermissionRule } from '../permissions';

/**
 * The maximum number of read-only tool calls executed CONCURRENTLY when the
 * model asks for several in one turn. Native tool-calling frontiers routinely
 * batch 4-8 file reads; running them sequentially is pure wall-clock loss.
 * Six covers the common batches while bounding concurrent file descriptors
 * and DB event writes.
 */
export const MAX_PARALLEL_READS = 6;

/**
 * A tool call that is safe to run concurrently with its siblings: it only
 * READS (workspace files, repository state) and cannot mutate the workspace,
 * the task, or anything outside it. Anything stateful, mutating, external,
 * or write-capable-by-unknown-effect (MCP) stays sequential.
 *
 * Deliberately conservative: file_read/file_list and the four git READ ops.
 * http_request mutates external services on non-GET verbs; browser touches
 * the user's live session; todo_update/task_complete mutate run state.
 */
export function isParallelSafeRead(name: string, args: Record<string, any> | undefined): boolean {
  if (name === 'file_read' || name === 'file_list') return true;
  if (name === 'git_op' && args && isGitOp(args.op)) return GIT_READ_OPS.has(args.op);
  return false;
}

/**
 * Run one read-only tool WITHOUT emitting its tool_result event — the
 * parallel batch emits results in deterministic call order after all
 * complete, so the audit stream stays ordered (call, call, … result, result)
 * instead of interleaving by completion time. Errors are shaped exactly like
 * safeExecute's so the model sees an identical observation either way.
 */
export async function executeReadSilently(
  taskId: string,
  name: string,
  args: Record<string, any>,
  ctx: ReturnType<typeof createToolContext>,
): Promise<string> {
  try {
    return await executeTool(name, args, ctx);
  } catch (err: any) {
    const raw = err?.message ? String(err.message) : 'tool error';
    const message = raw
      .replace(/\/[\w/.-]+/g, '<path>')
      .replace(/(?:^|\s)(\.\.?\/[^\s]+)/g, ' <relpath>')
      .replace(/(?:EPERM|EACCES|ENOENT|EISDIR|ENOTDIR)/g, '<error>')
      .slice(0, 500);
    console.error(`[agent] tool ${name} failed task=${taskId}:`, err);
    return `Error: ${message}`;
  }
}

/**
 * Recompute the authority verdict for a tool call so audit hooks can cite
 * the exact rule that governed it (v1.23, audit #2 — the verdict already
 * existed inside executeTool but never reached the hook context, so every
 * persisted audit event carried null citations). authorizeToolCall is pure,
 * so recomputing here is side-effect-free and cannot diverge from the gate
 * that actually dispatched the call.
 */
export function verdictCitation(
  name: string,
  args: Record<string, unknown>,
  rules: readonly PermissionRule[],
): { permissionRuleIndex?: number; permissionEffect?: string } {
  try {
    const verdict = authorizeToolCall(name, args, rules);
    return {
      permissionRuleIndex: verdict.ruleIndex,
      permissionEffect: verdict.effect ?? verdict.decision,
    };
  } catch {
    return {};
  }
}

export async function safeExecute(
  taskId: string,
  name: string,
  args: Record<string, any>,
  ctx: ReturnType<typeof createToolContext>,
): Promise<string> {
  try {
    const result = await executeTool(name, args, ctx);
    await emitTaskEvent(taskId, 'tool_result', { name, ok: true, result });
    return result;
  } catch (err: any) {
    const raw = err?.message ? String(err.message) : 'tool error';
    // Sanitize error messages: strip filesystem paths and internal details.
    const message = raw
      .replace(/\/[\w/.-]+/g, '<path>')          // absolute paths
      .replace(/(?:^|\s)(\.\.?\/[^\s]+)/g, ' <relpath>') // relative paths
      .replace(/(?:EPERM|EACCES|ENOENT|EISDIR|ENOTDIR)/g, '<error>') // errno codes
      .slice(0, 500); // cap error message length
    console.error(`[agent] tool ${name} failed task=${taskId}:`, err);
    await emitTaskEvent(taskId, 'tool_result', { name, ok: false, error: message });
    return `Error: ${message}`;
  }
}
