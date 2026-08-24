/**
 * SSE emitter — single delivery path (AGENTS.md rule 2).
 *
 * The V1 bug was two replay sources (in-memory buffer + DB) feeding one
 * consumer with no shared seen-set, causing duplicate events. V2 fixes this
 * structurally:
 *
 *   1. Every event is persisted FIRST via appendTaskEvent(), which assigns a
 *      monotonic per-task `seq`.
 *   2. The persisted row (with its seq) is then forwarded to any live
 *      listeners. There is no separate in-memory replay buffer.
 *   3. On connect, the stream route replays from the DB only (ordered by seq),
 *      tracks maxSeq, then forwards live events, skipping seq <= maxSeq.
 *
 * Persistence failures are logged with context and rethrown — never silent
 * (AGENTS.md rule 3). If we cannot persist, we do not emit a phantom live
 * event that would never appear on reload.
 */

import { EventEmitter } from 'node:events';
import { appendTaskEvent } from '../db/queries';
import type { TaskEvent } from '../types';

class TaskEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // many concurrent SSE subscribers
  }
}

const bus = new TaskEventBus();

function channel(taskId: string): string {
  return `task:${taskId}`;
}

/**
 * Persist an event (assigning seq) and forward the stored row to live
 * subscribers. Returns the stored row. Throws on persistence failure.
 */
export async function emitTaskEvent(taskId: string, type: string, content: unknown): Promise<TaskEvent> {
  let row: TaskEvent;
  try {
    row = await appendTaskEvent(taskId, type, content);
  } catch (err) {
    console.error(`[sse] failed to persist event task=${taskId} type=${type}:`, err);
    throw err;
  }
  bus.emit(channel(taskId), row);
  return row;
}

/** Subscribe to live persisted events for a task. Returns an unsubscribe fn. */
export function subscribeTask(taskId: string, listener: (row: TaskEvent) => void): () => void {
  const ch = channel(taskId);
  bus.on(ch, listener);
  return () => {
    bus.off(ch, listener);
  };
}
