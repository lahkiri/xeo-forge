/**
 * Runner — entry point that launches an agent run.
 *
 * The task row already exists (status=pending) and creation credits are
 * already debited by the route before this is called. This starts the run
 * fire-and-forget; the caller does not await it.
 *
 * If the run throws (it shouldn't — runAgent handles its own errors), we mark
 * the task failed AND emit a failure event so the failure is never silent
 * (AGENTS.md rule 3).
 *
 * Idempotency: if the task is already in a terminal state (completed, failed,
 * planned), the catch block does NOT emit duplicate error/done events. This
 * prevents the double-fail pattern where runAgent's internal failRun() emits
 * events and then a secondary throw causes the catch to fire again.
 */

import { runAgent } from './loop';
import type { TaskMode } from '../types';
import { getTaskById, updateTaskStatus } from '../db/queries';
import { emitTaskEvent } from '../sse/emitter';

export function startAgentRun(args: {
  taskId: string;
  userId: string;
  goal: string;
  mode: TaskMode;
  projectPath?: string | null;
  approvedPlan?: string | null;
  /**
   * v1.21 wiring: the authority level the run executes under. Routes pass the
   * value stored on the task row; loop.ts normalizes and falls back to
   * 'execute' for direct callers that omit it.
   */
  autonomyLevel?: string | null;
}): void {
  runAgent(args).catch(async (err) => {
    console.error(`[runner] unhandled agent error task=${args.taskId}:`, err);
    try {
      // Idempotency check: if the task is already in a terminal state,
      // runAgent's internal error handling already emitted events.
      // Do not emit duplicate error/done events.
      const existing = await getTaskById(args.taskId);
      const terminalStates = ['completed', 'failed', 'planned', 'cancelled'];
      if (existing && terminalStates.includes(existing.status)) {
        console.log(`[runner] task ${args.taskId} already in terminal state '${existing.status}' — skipping duplicate failure emission`);
        return;
      }

      await updateTaskStatus(args.taskId, 'failed', {
        error: err?.message ? String(err.message) : 'Agent run exited without completing.',
      });
      await emitTaskEvent(args.taskId, 'error', { message: err?.message ? String(err.message) : 'Agent run exited without completing.' });
      await emitTaskEvent(args.taskId, 'done', { status: 'failed' });
    } catch (inner) {
      console.error(`[runner] failed to record failure task=${args.taskId}:`, inner);
    }
  });
}

