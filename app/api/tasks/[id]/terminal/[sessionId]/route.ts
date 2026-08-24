import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import {
  writeToSession,
  resizeSession,
  killSession,
  TerminalError,
} from '@/lib/agent/terminal';
import { errorResponse } from '../../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WriteSchema = z.object({
  data: z.string().min(1).max(65536),
});

const ResizeSchema = z.object({
  cols: z.number().int().min(40).max(300),
  rows: z.number().int().min(5).max(80),
});

/**
 * POST /api/tasks/:id/terminal/:sessionId — write input to a terminal session.
 * PATCH /api/tasks/:id/terminal/:sessionId — resize a terminal session.
 * DELETE /api/tasks/:id/terminal/:sessionId — kill a terminal session.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const body = await req.json();
    const parsed = WriteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data is required.' }, { status: 400 });
    }

    writeToSession(params.sessionId, user.id, parsed.data.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TerminalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse('terminal/write', err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const body = await req.json();
    const parsed = ResizeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'cols and rows are required.' }, { status: 400 });
    }

    resizeSession(params.sessionId, user.id, parsed.data.cols, parsed.data.rows);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TerminalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse('terminal/resize', err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const killed = killSession(params.sessionId, user.id);
    if (killed) {
      // Explicit user-driven close. Natural exits are NOT evented (see the
      // create route comment) — one shell, one closed event, no fan-out per
      // stream viewer.
      await emitTaskEvent(params.id, 'terminal', {
        session_id: params.sessionId,
        status: 'closed',
        reason: 'killed by user',
      }).catch((err) => console.warn('[terminal/kill] failed to record close event:', err));
    }
    return NextResponse.json({ ok: true, killed });
  } catch (err) {
    if (err instanceof TerminalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse('terminal/kill', err);
  }
}
