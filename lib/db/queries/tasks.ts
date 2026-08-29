/**
 * tasks domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { isAutonomyLevel } from '../../agent/permissions';
import { DEFAULT_THINKING_EFFORT, isThinkingEffort } from '../../model/thinking';
import { DEFAULT_SANDBOX_MODE, isSandboxMode } from '../../agent/sandbox';
import { nowIso } from './shared';
import { getAgentProfileById, getAgentSkillById } from './profiles';
import type {
  Task,
  TaskStatus,
  TaskMode,
  TaskIntentKind,
  DecisionState,
  TaskDecisionChoice,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export async function createTask(input: {
  userId: string;
  goal: string;
  mode: TaskMode;
  projectPath?: string | null;
  profileId?: string | null;
  skillId?: string | null;
  providerId?: string | null;
  providerModelId?: string | null;
  /** Validated upstream; re-checked here so no internal caller can store an arbitrary string. */
  autonomyLevel?: string | null;
  /** Validated upstream via normalizeThinkingEffort; stored verbatim when valid. */
  thinkingEffort?: string | null;
  /** Validated upstream via normalizeSandboxMode; stored verbatim when valid. */
  sandboxMode?: string | null;
  status?: TaskStatus;
  intentKind?: TaskIntentKind | null;
  decisionState?: DecisionState;
  decisionExpiresAt?: string | null;
}): Promise<Task> {
  const id = uuidv4();
  const ts = nowIso();
  let profileId: string | null = null;
  let skillId: string | null = null;
  if (input.profileId) {
    const profile = await getAgentProfileById(input.profileId, input.userId);
    if (!profile || !profile.enabled) throw new Error('Selected agent profile is not available.');
    profileId = profile.id;
  }
  if (input.skillId) {
    const skill = await getAgentSkillById(input.skillId, input.userId);
    if (!skill || !skill.enabled) throw new Error('Selected agent skill is not available.');
    skillId = skill.id;
    if (!profileId && skill.profile_id) {
      const skillProfile = await getAgentProfileById(skill.profile_id, input.userId);
      if (skillProfile?.enabled) profileId = skillProfile.id;
    }
  }
  await db
    .prepare(
      `INSERT INTO tasks (id, user_id, goal, status, mode, project_path, intent_kind, decision_state, decision_expires_at, plan_version, profile_id, skill_id, provider_id, provider_model_id, autonomy_level, thinking_effort, sandbox_mode, credits_spent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.goal,
      input.status ?? 'pending',
      input.mode,
      input.projectPath ?? null,
      input.intentKind ?? null,
      input.decisionState ?? null,
      input.decisionExpiresAt ?? null,
      profileId,
      skillId,
      input.providerId ?? null,
      input.providerModelId ?? null,
      isAutonomyLevel(input.autonomyLevel) ? input.autonomyLevel : 'execute',
      isThinkingEffort(input.thinkingEffort) ? input.thinkingEffort : DEFAULT_THINKING_EFFORT,
      isSandboxMode(input.sandboxMode) ? input.sandboxMode : DEFAULT_SANDBOX_MODE,
      ts,
      ts,
    );
  const task = await getTaskById(id);
  if (!task) throw new Error('createTask: task not found after insert');
  return task;
}

export async function getTaskById(id: string): Promise<Task | undefined> {
  return db.prepare<Task>(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

export type TaskDecisionResolution =
  | { outcome: 'resolved'; task: Task }
  | { outcome: 'expired'; task: Task }
  | { outcome: 'already_resolved' | 'not_found'; task?: Task };

/**
 * Resolve the Work direct-vs-plan card exactly once. The conditional UPDATE is
 * the authority; the UI timer is only presentation — a window that closed
 * never executes anything by itself, but the operator's explicit click
 * remains valid at any time (v1.25: a late decision resolves the card and
 * is marked honestly in the decision's audit event, instead of stranding
 * the operator with no gate, no composer, and no escape).
 */
export async function resolveTaskDecision(
  id: string,
  choice: TaskDecisionChoice,
  approvedPlan: string | null,
): Promise<TaskDecisionResolution> {
  const now = nowIso();
  const nextMode: TaskMode = choice === 'direct' ? 'build' : 'planning';
  const res = await db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           mode = ?,
           approved_plan = ?,
           decision_state = 'resolved',
           decision_expires_at = NULL,
           error = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'awaiting_decision'
         AND decision_state = 'pending'
         AND decision_expires_at IS NOT NULL`,
    )
    .run(nextMode, approvedPlan, now, id);

  if (res.changes > 0) {
    const task = await getTaskById(id);
    if (!task) throw new Error('resolveTaskDecision: task disappeared after transition');
    return { outcome: 'resolved', task };
  }

  const task = await getTaskById(id);
  if (!task) return { outcome: 'not_found' };
  if (task.status === 'awaiting_decision' && task.decision_state === 'pending') {
    // Unreachable while the resolution UPDATE above has no deadline clause —
    // kept as defense-in-depth so the vocabulary can never regress.
    const expired = await db
      .prepare(
        `UPDATE tasks
         SET decision_state = 'expired',
             updated_at = ?
         WHERE id = ? AND status = 'awaiting_decision'
           AND decision_state = 'pending'
           AND decision_expires_at IS NOT NULL
           AND decision_expires_at <= ?`,
      )
      .run(now, id, now);
    if (expired.changes > 0) {
      const expiredTask = await getTaskById(id);
      if (!expiredTask) throw new Error('resolveTaskDecision: expired task disappeared');
      return { outcome: 'expired', task: expiredTask };
    }
  }
  return { outcome: 'already_resolved', task: await getTaskById(id) };
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
 * v1.25: 'cancelled' joined the claimable set — the Work composer renders on
 * every terminal status, so a cancelled run must accept its follow-up too.
 */
export async function claimTaskForFollowUp(id: string): Promise<Task | undefined> {
  const res = await db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           error = NULL,
           updated_at = ?
       WHERE id = ? AND status IN ('completed', 'failed', 'planned', 'cancelled')`,
    )
    .run(nowIso(), id);
  if (res.changes === 0) return undefined;
  return getTaskById(id);
}

/**
 * Update the thinking-effort level on a task (v1.23). Called by the
 * follow-up-message route when the user picks a new level before sending —
 * the NEXT run then executes at the level shown in the UI. Ownership-scoped.
 */
export async function updateTaskThinkingEffort(
  taskId: string,
  userId: string,
  effort: unknown,
): Promise<void> {
  const level = isThinkingEffort(effort) ? effort : DEFAULT_THINKING_EFFORT;
  await db
    .prepare(`UPDATE tasks SET thinking_effort = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(level, nowIso(), taskId, userId);
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
  // no approved_plan), so we refuse it here — the UI uses approve for that.
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
