import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, rejectTaskPlan } from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RejectSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

/**
 * Reject a task's proposed plan. Instead of killing the task, resets it to
 * planning mode so the user can revise. Atomic conditional UPDATE guarded by
 * status='planned' → mode='planning', status='pending'.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    let reason = 'Plan rejected — returning to planning mode for revision.';
    try {
      const body = await req.json();
      const parsed = RejectSchema.safeParse(body);
      if (parsed.success && parsed.data.reason) reason = parsed.data.reason;
    } catch {
      // No body is fine; use the default reason.
    }

    const ok = await rejectTaskPlan(params.id, reason);
    if (!ok) {
      return NextResponse.json(
        { error: 'Task is not awaiting plan approval.' },
        { status: 409 },
      );
    }

    // Emit events reflecting the transition back to planning.
    await emitTaskEvent(params.id, 'task_status', { status: 'pending' });
    await emitTaskEvent(params.id, 'mode', { mode: 'planning' });

    // Automatically start a new planning run so the agent re-inspects and
    // produces a revised plan.
    const updated = await getTaskById(params.id);
    if (updated) {
      startAgentRun({
        taskId: updated.id,
        userId: task.user_id,
        goal: updated.goal,
        mode: 'planning',
      });
    }

    return NextResponse.json({ task: updated }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/reject', err);
  }
}
