/**
 * events domain queries (moved verbatim from queries.ts).
 */

import { db } from '../index';
import { nowIso, isUniqueViolation } from './shared';
import type {
  TaskEvent,
  Message,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Task events (seq-ordered, single delivery path)                    */
/* ------------------------------------------------------------------ */

/**
 * Append an event with the next monotonic per-task seq.
 * Returns the stored row (including seq) so callers can forward it live.
 *
 * Uses a subquery to compute next seq. UNIQUE(task_id, seq) is the arbiter
 * under concurrency; appendTaskEvent retries a collision rather than dropping
 * the event or failing the whole run.
 */
export async function appendTaskEvent(taskId: string, type: string, content: unknown): Promise<TaskEvent> {
  const json = JSON.stringify(content ?? {});

  // MAX(seq)+1 is only a hint under concurrency. The UNIQUE(task_id, seq)
  // constraint is the arbiter; retrying a collision lets the loser pick the
  // next sequence instead of dropping the event or failing the whole run.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ts = nowIso();
    const seqRow = await db
      .prepare<{ next_seq: number }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_id = ?`,
      )
      .get(taskId);
    const seq = seqRow?.next_seq ?? 1;
    try {
      await db
        .prepare(
          `INSERT INTO task_events (task_id, seq, type, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(taskId, seq, type, json, ts);
      const row = await db
        .prepare<TaskEvent>(`SELECT * FROM task_events WHERE task_id = ? AND seq = ?`)
        .get(taskId, seq);
      if (!row) throw new Error('appendTaskEvent: row not found after insert');
      return row;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 4) throw err;
    }
  }

  throw new Error('appendTaskEvent: exhausted sequence collision retries');
}

export async function getTaskEvents(taskId: string, afterSeq = 0): Promise<TaskEvent[]> {
  return db
    .prepare<TaskEvent>(
      `SELECT * FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(taskId, afterSeq);
}

/* ------------------------------------------------------------------ */
/* Messages (chat persistence per task)                               */
/* ------------------------------------------------------------------ */

export async function appendMessage(
  taskId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  active = 1,
): Promise<Message> {
  const ts = nowIso();
  if (db.kind === 'pg') {
    // PostgreSQL: RETURNING * gives us the inserted row atomically — no
    // race with concurrent writes that could steal ORDER BY id DESC LIMIT 1.
    const row = await db
      .prepare<Message>(
        `INSERT INTO messages (task_id, role, content, active, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(taskId, role, content, active, ts);
    if (!row) throw new Error('appendMessage: row not found after insert');
    return row;
  }
  // SQLite: single-writer so re-SELECT is safe.
  await db
    .prepare(
      `INSERT INTO messages (task_id, role, content, active, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(taskId, role, content, active, ts);
  const row = await db
    .prepare<Message>(
      `SELECT * FROM messages WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId);
  if (!row) throw new Error('appendMessage: row not found after insert');
  return row;
}

/** Get ALL messages for a task (for UI display — includes archived rows). */
export async function getMessages(taskId: string): Promise<Message[]> {
  return db
    .prepare<Message>(
      `SELECT * FROM messages WHERE task_id = ? ORDER BY id ASC`,
    )
    .all(taskId);
}

/**
 * Get only active messages — the live context window the agent loads each run.
 * Archived rows (active=0) are excluded; they are retained for audit/display.
 * Ordered by (created_at, id): the compaction summary is inserted with an
 * older created_at so it sorts FIRST, before the messages it summarizes.
 */
export async function getContextMessages(taskId: string): Promise<Message[]> {
  return db
    .prepare<Message>(
      `SELECT * FROM messages WHERE task_id = ? AND active = 1 ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId);
}

/**
 * Compact conversation history: archive old messages and insert a system summary.
 *
 * Strategy: keep the most recent `keepCount` active messages untouched, archive
 * everything before them (active=0), then insert ONE system summary message
 * (active=1) as the new oldest context. The summary preserves critical facts,
 * user intent, execution state, and plan/mode awareness.
 *
 * Returns the summary message so callers can inspect it.
 */
export async function compactMessages(
  taskId: string,
  summaryContent: string,
  keepCount: number,
): Promise<Message> {
  // 1. Get all active messages in order.
  const active = await db
    .prepare<Message>(
      `SELECT * FROM messages WHERE task_id = ? AND active = 1 ORDER BY id ASC`,
    )
    .all(taskId);

  if (active.length <= keepCount) return active[0] as Message;

  // 2. Archive the oldest messages, keeping the most recent `keepCount`.
  const toArchive = active.slice(0, active.length - keepCount);
  for (const msg of toArchive) {
    await db
      .prepare(`UPDATE messages SET active = 0 WHERE id = ?`)
      .run(msg.id);
  }

  // 3. Insert the compaction summary as an active system message, placed
  //    BEFORE the kept messages by inserting with a created_at timestamp
  //    just before the first kept message. This is what actually makes the
  //    summary sort first in getContextMessages() (created_at, id ordering).
  const firstKept = active[active.length - keepCount];
  let ts = nowIso();
  const firstKeptMs = firstKept ? Date.parse(firstKept.created_at) : NaN;
  if (firstKept && Number.isFinite(firstKeptMs)) {
    const prev = firstKeptMs - 1;
    ts = new Date(prev > 0 ? prev : 0).toISOString();
  }
  let summary: Message | undefined;
  if (db.kind === 'pg') {
    // PostgreSQL: RETURNING * avoids race with concurrent writes.
    summary = await db
      .prepare<Message>(
        `INSERT INTO messages (task_id, role, content, active, created_at) VALUES (?, 'system', ?, 1, ?) RETURNING *`,
      )
      .get(taskId, summaryContent, ts);
  } else {
    // SQLite: single-writer so re-SELECT is safe.
    await db
      .prepare(
        `INSERT INTO messages (task_id, role, content, active, created_at) VALUES (?, 'system', ?, 1, ?)`,
      )
      .run(taskId, summaryContent, ts);
    summary = await db
      .prepare<Message>(
        `SELECT * FROM messages WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId);
  }
  if (!summary) throw new Error('compactMessages: summary not found after insert');
  return summary;
}
