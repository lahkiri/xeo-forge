import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
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

    return NextResponse.json(describeSession(session), { status: 201 });
  } catch (err) {
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
