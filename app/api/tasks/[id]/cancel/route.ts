import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, updateTaskStatus } from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import { cancelRun } from '@/lib/agent/cancellation';
import { killSessionsForTask } from '@/lib/agent/terminal';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/:id/cancel — request cancellation of a running task.
 *
 * Propagation is cooperative and REAL: the AbortController signal stops the
 * model stream and the loop between iterations; terminal sessions the task
 * owns are killed immediately (same contract as run completion); the status
 * transitions through the same event trail as every other terminal state.
 *
 * Cancelling a non-running task answers 409 with the current status —
 * honest, idempotent, never silently "succeeds".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const running = ['pending', 'running'].includes(task.status);
    if (!running) {
      return NextResponse.json(
        { error: `Task is not running (status: ${task.status}). Cancellation applies to pending/running tasks only.` },
        { status: 409 },
      );
    }

    const signalled = cancelRun(params.id);
    const killedSessions = killSessionsForTask(params.id);

    await updateTaskStatus(params.id, 'cancelled');
    await emitTaskEvent(params.id, 'task_status', { status: 'cancelled' });
    await emitTaskEvent(params.id, 'done', {
      status: 'cancelled',
      summary: signalled ? 'Run cancelled by the operator.' : 'Run cancelled (no live loop was found; state reconciled).',
    });

    return NextResponse.json({ ok: true, signalled, killedSessions });
  } catch (err) {
    return errorResponse('tasks/cancel', err);
  }
}
