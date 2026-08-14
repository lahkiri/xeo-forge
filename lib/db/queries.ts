/**
 * Queries — the ONLY module that reads/writes application tables.
 *
 * Every other module goes through these functions. This keeps a single
 * writer per resource and prevents schema drift (AGENTS.md rule 1).
 *
 * Credits writes live in lib/credits/engine.ts (the single credits writer),
 * which uses the same db adapter; they are intentionally NOT duplicated here.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from './index';
import type {
  User,
  Task,
  TaskStatus,
  TaskMode,
  TaskEvent,
  Message,
  ModelSettings,
  AdminAction,
  Credits,
  CreditLedgerRow,
  Upload,
  UploadKind,
  UploadStatus,
} from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Users                                                              */
/* ------------------------------------------------------------------ */

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
  isAdmin?: boolean;
  isRootAdmin?: boolean;
}): Promise<User> {
  const id = uuidv4();
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, is_admin, is_root_admin, is_suspended, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.email.toLowerCase(),
      input.passwordHash,
      input.displayName,
      input.isAdmin ? 1 : 0,
      input.isRootAdmin ? 1 : 0,
      createdAt,
    );
  const user = await getUserById(id);
  if (!user) throw new Error('createUser: user not found after insert');
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.prepare<User>(`SELECT * FROM users WHERE id = ?`).get(id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.prepare<User>(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase());
}

export async function listUsers(): Promise<User[]> {
  return db.prepare<User>(`SELECT * FROM users ORDER BY created_at DESC`).all();
}

/** Admin view: every user with current balance and task count, newest first. */
export async function listUsersWithStats(): Promise<
  Array<User & { balance: number; task_count: number }>
> {
  return db
    .prepare<User & { balance: number; task_count: number }>(
      `SELECT u.*,
              COALESCE(c.balance, 0) AS balance,
              COALESCE(t.cnt, 0) AS task_count
         FROM users u
         LEFT JOIN credits c ON c.user_id = u.id
         LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM tasks GROUP BY user_id) t
                ON t.user_id = u.id
        ORDER BY u.created_at DESC`,
    )
    .all();
}

export async function setUserSuspended(id: string, suspended: boolean): Promise<void> {
  await db.prepare(`UPDATE users SET is_suspended = ? WHERE id = ?`).run(suspended ? 1 : 0, id);
}

export async function countUsers(): Promise<number> {
  const row = await db.prepare<{ c: number }>(`SELECT COUNT(*) AS c FROM users`).get();
  return row?.c ?? 0;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

export async function createSessionRow(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
  await db
    .prepare(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(tokenHash, userId, expiresAt);
}

export async function getSessionWithUser(
  tokenHash: string,
): Promise<{ user: User; expires_at: string } | undefined> {
  const row = await db
    .prepare<User & { expires_at: string }>(
      `SELECT u.*, s.expires_at AS expires_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return undefined;
  const { expires_at, ...user } = row as User & { expires_at: string };
  return { user: user as User, expires_at };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
}

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export async function createTask(input: {
  userId: string;
  goal: string;
  mode: TaskMode;
}): Promise<Task> {
  const id = uuidv4();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO tasks (id, user_id, goal, status, mode, plan_version, credits_spent, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?)`,
    )
    .run(id, input.userId, input.goal, input.mode, ts, ts);
  const task = await getTaskById(id);
  if (!task) throw new Error('createTask: task not found after insert');
  return task;
}

export async function getTaskById(id: string): Promise<Task | undefined> {
  return db.prepare<Task>(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

export async function getTasksByUser(userId: string): Promise<Task[]> {
  return db
    .prepare<Task>(`SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId);
}

export async function listAllTasks(
  limit = 200,
): Promise<(Task & { email: string | null })[]> {
  return db
    .prepare<Task & { email: string | null }>(
      `SELECT t.*, u.email
       FROM tasks t
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

/**
 * Atomically claim a terminal/planned task for a follow-up run.
 *
 * The conditional UPDATE is the single concurrency gate: only one request can
 * transition the task to pending, so only that request may start a runner.
 */
export async function claimTaskForFollowUp(id: string): Promise<Task | undefined> {
  const res = await db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           error = NULL,
           updated_at = ?
       WHERE id = ? AND status IN ('completed', 'failed', 'planned')`,
    )
    .run(nowIso(), id);
  if (res.changes === 0) return undefined;
  return getTaskById(id);
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
  fields?: { plan?: string; resultSummary?: string; error?: string; clearError?: boolean },
): Promise<void> {
  await db
    .prepare(
      `UPDATE tasks
       SET status = ?,
           plan = COALESCE(?, plan),
           result_summary = COALESCE(?, result_summary),
           error = CASE WHEN ? THEN NULL ELSE COALESCE(?, error) END,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      fields?.plan ?? null,
      fields?.resultSummary ?? null,
      fields?.clearError ? 1 : 0,
      fields?.error ?? null,
      nowIso(),
      id,
    );
}

export async function addTaskCredits(id: string, delta: number): Promise<void> {
  await db
    .prepare(`UPDATE tasks SET credits_spent = credits_spent + ?, updated_at = ? WHERE id = ?`)
    .run(delta, nowIso(), id);
}

/**
 * Approve the proposed plan and switch the task into build mode — atomically.
 *
 * This is the single gate that authorizes a build run. It snapshots the
 * latest proposed `plan` into the immutable `approved_plan`, flips
 * `mode` to 'build', resets `status` to 'pending' (so the build runner can
 * start), and bumps `plan_version`. The `WHERE status = 'planned'` guard makes
 * this a no-op unless the task is actually awaiting approval, which prevents
 * both "build without an approved plan" and double-approval races (the second
 * caller sees changes === 0).
 *
 * Returns true if the transition happened, false if the task was not in the
 * 'planned' state.
 */
export async function approveTaskPlan(id: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE tasks
       SET approved_plan = plan,
           mode = 'build',
           status = 'pending',
           plan_version = plan_version + 1,
           error = NULL,
           updated_at = ?
       WHERE id = ? AND status = 'planned'`,
    )
    .run(nowIso(), id);
  return res.changes > 0;
}

/**
 * Reject a proposed plan. Instead of killing the task, resets to planning mode
 * so the user can revise. Atomic, guarded by `status = 'planned'`.
 * Returns true if it transitioned.
 */
export async function rejectTaskPlan(id: string, reason: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           mode = 'planning',
           error = ?,
           updated_at = ?
       WHERE id = ? AND status = 'planned'`,
    )
    .run(reason, nowIso(), id);
  return res.changes > 0;
}

/**
 * Switch a task's mode. Atomic, guarded by non-running status.
 *
 * Allowed transitions:
 *   - any non-running, non-pending → planning (resets for revision)
 *   - planned → build (same as approve, but without snapshotting — use approveTaskPlan for that)
 *
 * When switching to planning: clears approved_plan, resets status to pending
 * so a new planning run can start.
 */
export async function switchTaskMode(
  id: string,
  mode: TaskMode,
): Promise<boolean> {
  if (mode === 'planning') {
    // Switching to planning: clear approved plan, reset to pending for a new run.
    const res = await db
      .prepare(
        `UPDATE tasks
         SET mode = 'planning',
             status = 'pending',
             approved_plan = NULL,
             error = NULL,
             updated_at = ?
         WHERE id = ? AND status NOT IN ('running', 'pending')`,
      )
      .run(nowIso(), id);
    return res.changes > 0;
  }
  // Switching to build: must go through approveTaskPlan when the task is
  // awaiting approval (status='planned') so approved_plan is snapshotted.
  // Flipping mode alone from 'planned' would leave a dead state (mode=build +
  // no approved_plan), so we refuse it here �?" the UI uses approve for that.
  const res = await db
    .prepare(
      `UPDATE tasks
       SET mode = 'build',
           updated_at = ?
       WHERE id = ? AND status NOT IN ('running', 'pending', 'planned')
         AND approved_plan IS NOT NULL AND length(trim(approved_plan)) > 0`,
    )
    .run(nowIso(), id);
  return res.changes > 0;
}

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
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const message = String((err as { message?: unknown })?.message ?? err);
  return code === '23505' || /unique constraint|duplicate key/i.test(message);
}

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

/* ------------------------------------------------------------------ */
/* Model settings (single row id=1)                                   */
/* ------------------------------------------------------------------ */

export async function getModelSettings(): Promise<ModelSettings | undefined> {
  return db.prepare<ModelSettings>(`SELECT * FROM model_settings WHERE id = 1`).get();
}

export async function upsertModelSettings(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  autoCompactThreshold?: number;
}): Promise<void> {
  const existing = await getModelSettings();
  const ts = nowIso();
  const contextWindow = input.contextWindow ?? 128000;
  const threshold = input.autoCompactThreshold ?? 80;
  if (existing) {
    await db
      .prepare(
        `UPDATE model_settings
         SET name = ?, base_url = ?, api_key = ?, model_id = ?, temperature = ?,
             max_tokens = ?, context_window = ?, auto_compact_threshold = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.name, input.baseUrl, input.apiKey, input.modelId,
        input.temperature, input.maxTokens, contextWindow, threshold, ts,
      );
  } else {
    await db
      .prepare(
        `INSERT INTO model_settings (id, name, base_url, api_key, model_id, temperature,
         max_tokens, context_window, auto_compact_threshold, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name, input.baseUrl, input.apiKey, input.modelId,
        input.temperature, input.maxTokens, contextWindow, threshold, ts,
      );
  }
}

/* ------------------------------------------------------------------ */
/* Admin actions (audit)                                              */
/* ------------------------------------------------------------------ */

export async function recordAdminAction(input: {
  adminId: string;
  targetUserId?: string | null;
  action: string;
  detail?: string | null;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_actions (admin_id, target_user_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.adminId, input.targetUserId ?? null, input.action, input.detail ?? null, nowIso());
}

export async function listAdminActions(limit = 200): Promise<AdminAction[]> {
  return db
    .prepare<AdminAction>(`SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

/* ------------------------------------------------------------------ */
/* Credits read helpers (writes live in lib/credits/engine.ts)        */
/* ------------------------------------------------------------------ */

export async function getCredits(userId: string): Promise<Credits | undefined> {
  return db.prepare<Credits>(`SELECT * FROM credits WHERE user_id = ?`).get(userId);
}

export async function getLedger(userId: string, limit = 100): Promise<CreditLedgerRow[]> {
  return db
    .prepare<CreditLedgerRow>(
      `SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, limit);
}

/* ------------------------------------------------------------------ */
/* Uploads (single writer for the uploads table)                      */
/* ------------------------------------------------------------------ */

/**
 * Create an upload row in the initial 'quarantined' state. The file bytes are
 * written to the task workspace by the route handler BEFORE the agent can ever
 * see them (status gates exposure). `relPath` is workspace-relative (_uploads/<id>).
 */
export async function createUpload(input: {
  taskId: string;
  userId: string;
  filename: string;
  kind: UploadKind;
  byteSize: number;
  relPath: string;
}): Promise<Upload> {
  const id = uuidv4();
  const ts = nowIso();
  if (db.kind === 'pg') {
    // PostgreSQL: RETURNING * avoids race with concurrent writes.
    const row = await db
      .prepare<Upload>(
        `INSERT INTO uploads
         (id, task_id, user_id, filename, kind, status, byte_size, rel_path,
          file_count, extracted_bytes, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, 0, 0, NULL, ?, ?) RETURNING *`,
      )
      .get(id, input.taskId, input.userId, input.filename, input.kind, input.byteSize, input.relPath, ts, ts);
    if (!row) throw new Error('createUpload: row not found after insert');
    return row;
  }
  // SQLite: single-writer so re-SELECT by PK is safe.
  await db
    .prepare(
      `INSERT INTO uploads
       (id, task_id, user_id, filename, kind, status, byte_size, rel_path,
        file_count, extracted_bytes, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, 0, 0, NULL, ?, ?)`,
    )
    .run(id, input.taskId, input.userId, input.filename, input.kind, input.byteSize, input.relPath, ts, ts);
  const row = await getUploadById(id);
  if (!row) throw new Error('createUpload: row not found after insert');
  return row;
}

export async function getUploadById(id: string): Promise<Upload | undefined> {
  return db.prepare<Upload>(`SELECT * FROM uploads WHERE id = ?`).get(id);
}

/** All uploads for a task in chronological order — for UI + agent manifest. */
export async function getUploadsByTask(taskId: string): Promise<Upload[]> {
  return db
    .prepare<Upload>(`SELECT * FROM uploads WHERE task_id = ? ORDER BY created_at ASC, id ASC`)
    .all(taskId);
}

/** Only uploads the agent is allowed to reference (validated + extracted). */
export async function getReadyUploadsByTask(taskId: string): Promise<Upload[]> {
  return db
    .prepare<Upload>(
      `SELECT * FROM uploads WHERE task_id = ? AND status = 'ready' ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId);
}

/**
 * Advance an upload through its lifecycle. Persisting a terminal state
 * ('ready' | 'rejected') with counts/error is how the pipeline records its
 * verdict — failures are NEVER silent (AGENTS.md rule 3).
 */
export async function updateUploadStatus(
  id: string,
  status: UploadStatus,
  fields: { fileCount?: number; extractedBytes?: number; error?: string | null } = {},
): Promise<Upload | undefined> {
  await db
    .prepare(
      `UPDATE uploads
       SET status = ?,
           file_count = COALESCE(?, file_count),
           extracted_bytes = COALESCE(?, extracted_bytes),
           error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      fields.fileCount ?? null,
      fields.extractedBytes ?? null,
      fields.error ?? null,
      nowIso(),
      id,
    );
  return getUploadById(id);
}

/**
 * Record the resolved workspace-relative path of an upload once extraction
 * succeeds. rel_path is written exactly once here (single writer) — the agent
 * manifest and UI read it to reference the inert, validated files.
 */
export async function setUploadRelPath(id: string, relPath: string): Promise<Upload | undefined> {
  await db
    .prepare(`UPDATE uploads SET rel_path = ?, updated_at = ? WHERE id = ?`)
    .run(relPath, nowIso(), id);
  return getUploadById(id);
}
