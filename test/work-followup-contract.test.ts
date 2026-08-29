import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Follow-up availability contract (desktop-parity batch, Phase 3.1).
 *
 * The operator-facing law: after ANY naturally finished, cancelled, or
 * undecided state, the operator can act again — the work surface must
 * never strand them. Code-tracing the live "no follow-up unless it
 * failed" report found three concrete defects:
 *
 *   D1. claimTaskForFollowUp refused 'cancelled' although the Work client
 *       renders the composer on every terminal status — cancelling a run
 *       left a composer whose every send 409ed with a lying "already
 *       running" message.
 *   D2. resolveTaskDecision hard-rejected late decisions although its own
 *       doc comment says "the UI timer is only presentation". An expired
 *       direct-request window stranded the operator completely: the gate
 *       unmounted (countdown 0), the composer's send 409ed, and a late
 *       decision 409ed — the only escapes were the rail's replan button
 *       or abandoning the task. The fix keeps the safety property (expiry
 *       never defaults to execution — nothing runs without an explicit
 *       click) and makes the timer presentation-only, as documented.
 *   D3. The work client ignored terminal `task_status` events and waited
 *       exclusively for `done`; any lost done event (SSE reconnect window)
 *       left the status stuck on 'running' with the composer hidden until
 *       the reconciliation poll happened to rescue it.
 *
 * Every behavioral pin here FAILED against the code that shipped in
 * v1.24.0 — they are the defect proof and the regression guard.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-followup-'));
process.env.DB_PATH = path.join(tempDir, 'followup.sqlite');

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let createTask: typeof import('../lib/db/queries').createTask;
let claimTaskForFollowUp: typeof import('../lib/db/queries').claimTaskForFollowUp;
let resolveTaskDecision: typeof import('../lib/db/queries').resolveTaskDecision;
let updateTaskStatus: typeof import('../lib/db/queries').updateTaskStatus;

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  createTask = queries.createTask;
  claimTaskForFollowUp = queries.claimTaskForFollowUp;
  resolveTaskDecision = queries.resolveTaskDecision;
  updateTaskStatus = queries.updateTaskStatus;
  db = database.db;
  await initSchema();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('D1 — a cancelled run is claimable for a follow-up', () => {
  it('claims a cancelled task back to pending', async () => {
    const user = await createUser({
      email: `cancel-claim-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Cancel Claim',
    });
    const task = await createTask({ userId: user.id, goal: 'Cancelled mid-build', mode: 'build' });
    await updateTaskStatus(task.id, 'completed'); // reach a live terminal row first
    await updateTaskStatus(task.id, 'cancelled');

    const claimed = await claimTaskForFollowUp(task.id);
    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe('pending');
  });

  it('still refuses to claim a running task (the concurrency gate holds)', async () => {
    const user = await createUser({
      email: `running-claim-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Running Claim',
    });
    const task = await createTask({ userId: user.id, goal: 'Still running', mode: 'build' });
    await updateTaskStatus(task.id, 'running');
    expect(await claimTaskForFollowUp(task.id)).toBeUndefined();
  });
});

describe('D2 — a late decision is the operator’s explicit choice', () => {
  it('resolves an expired direct-request window instead of stranding the operator', async () => {
    const user = await createUser({
      email: `late-decision-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Late Decider',
    });
    const task = await createTask({
      userId: user.id,
      goal: 'Direct request whose window closed',
      mode: 'build',
      status: 'awaiting_decision',
      decisionState: 'pending',
      decisionExpiresAt: new Date(Date.now() - 60_000).toISOString(), // closed a minute ago
    });

    const resolution = await resolveTaskDecision(task.id, 'plan', null);
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.task?.mode).toBe('planning');
    expect(resolution.task?.decision_state).toBe('resolved');
    expect(resolution.task?.status).toBe('pending');
  });

  it('resolves an in-window decision exactly as before (no regression)', async () => {
    const user = await createUser({
      email: `fresh-decision-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Fresh Decider',
    });
    const task = await createTask({
      userId: user.id,
      goal: 'Direct request inside the window',
      mode: 'build',
      status: 'awaiting_decision',
      decisionState: 'pending',
      decisionExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    });

    const resolution = await resolveTaskDecision(task.id, 'direct', 'do it directly');
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.task?.mode).toBe('build');
    expect(resolution.task?.approved_plan).toBe('do it directly');
  });

  it('still reports already_resolved for a double decision', async () => {
    const user = await createUser({
      email: `double-decision-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Double Decider',
    });
    const task = await createTask({
      userId: user.id,
      goal: 'Decide once only',
      mode: 'build',
      status: 'awaiting_decision',
      decisionState: 'pending',
      decisionExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    await resolveTaskDecision(task.id, 'direct', 'brief');
    const second = await resolveTaskDecision(task.id, 'plan', null);
    expect(second.outcome).toBe('already_resolved');
  });
});

describe('D3 — the work surface adopts terminal task_status events', () => {
  const runState = readSrc('app/work/useWorkRunState.ts');

  it('no longer skips completed/failed while waiting for `done`', () => {
    // The v1.24 code: `if (data.status !== 'completed' && data.status !== 'failed') setStatus(...)`
    expect(runState).not.toMatch(/data\.status !== 'completed' && data\.status !== 'failed'/);
    expect(runState).toMatch(/task_status' && typeof data\.status === 'string'/);
  });

  it('keeps the `done` handler for the summary/message path', () => {
    expect(runState).toMatch(/type === 'done' && typeof data\.status === 'string'/);
  });
});

describe('client contract — the decision gate and composer never strand the operator', () => {
  it('DecisionGate renders while a decision is pending, even with the window closed', () => {
    const client = readSrc('app/work/WorkClient.tsx');
    // The gate condition must not require decisionSeconds > 0.
    expect(client).toMatch(/status === 'awaiting_decision' && task\.decision_state === 'pending'/);
    expect(client).not.toMatch(/decisionSeconds > 0/);
  });

  it('DecisionGate surfaces the honest window-closed state', () => {
    const primitives = readSrc('components/WorkPrimitives.tsx');
    expect(primitives).toMatch(/windowClosed/);
  });

  it('a follow-up on an undecided run returns honest guidance, not "already running"', () => {
    const messages = readSrc('app/api/tasks/[id]/messages/route.ts');
    expect(messages).toMatch(/waiting for your decision/);
    expect(messages).toMatch(/Approve or reject/);
  });

  it('the claim query admits every state the composer renders for', () => {
    // The composer renders on completed/failed/cancelled/planned; the claim
    // must accept exactly that vocabulary.
    const tasks = readSrc('lib/db/queries/tasks.ts');
    expect(tasks).toMatch(/status IN \('completed', 'failed', 'planned', 'cancelled'\)/);
  });
});
