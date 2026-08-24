import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import {
  createSession,
  describeSession,
  sessionsForTask,
  TerminalError,
} from '@/lib/agent/terminal';
import { errorResponse } from '../../../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  cols: z.number().int().min(40).max(300).optional(),
  rows: z.number().int().min(5).max(80).optional(),
});

/**
 * POST /api/tasks/:id/terminal — create a new terminal session for a task.
 * GET  /api/tasks/:id/terminal — list live terminal sessions for a task.
 *
 * Every create/kill is recorded as a `terminal` task event: a real host shell
 * was opened on this task, and that is governance-relevant history the activity
 * timeline must show. Natural process exit is NOT evented here — it is observed
 * through the stream and the session list; only user-driven lifecycle changes
 * (open, refuse, kill) write events, so one shell cannot emit N duplicate
 * "closed" events for N viewers.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const limited = rateLimit(
      `taskTerminal:${user.id}`,
      RATE_LIMITS.taskCreate.limit,
      RATE_LIMITS.taskCreate.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid terminal parameters.' }, { status: 400 });
    }

    const session = await createSession({
      taskId: params.id,
      ownerId: user.id,
      projectPath: task.project_path,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
    });

    // Audit: a real host shell was opened for this task. Emission failure is
    // logged inside emitTaskEvent and must not fail the create — the session
    // exists either way and the user needs its id.
    await emitTaskEvent(params.id, 'terminal', {
      session_id: session.id,
      status: 'opened',
    }).catch((err) => console.warn(`[terminal/create] failed to record open event:`, err));

    return NextResponse.json(describeSession(session), { status: 201 });
  } catch (err) {
    // A refusal (limits, missing native module) is part of the task's history
    // too: "we declined to open a shell" is a governance fact.
    if (err instanceof TerminalError) {
      await emitTaskEvent(params.id, 'terminal', {
        status: 'rejected',
        reason: err.message,
      }).catch(() => {});
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse('terminal/create', err);
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const sessions = sessionsForTask(params.id);
    return NextResponse.json({
      sessions: sessions.map((s) => describeSession(s)),
    });
  } catch (err) {
    return errorResponse('terminal/list', err);
  }
}
