import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, approveTaskPlan } from '@/lib/db/queries';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Approve a task's proposed plan and start the build run.
 *
 * approveTaskPlan is a single atomic conditional UPDATE guarded by
 * status='planned': it freezes plan -> approved_plan, flips mode to 'build',
 * resets status to 'pending', and bumps plan_version. This is the only gate
 * into build mode (prevents build-without-plan and double-approval races).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const ok = await approveTaskPlan(params.id);
    if (!ok) {
      return NextResponse.json(
        { error: 'Task is not awaiting plan approval.' },
        { status: 409 },
      );
    }

    // Re-read to get the frozen snapshot + bumped version.
    const updated = await getTaskById(params.id);
    if (!updated) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    startAgentRun({
      taskId: updated.id,
      userId: task.user_id,
      goal: updated.goal,
      mode: 'build',
      approvedPlan: updated.approved_plan,
    });

    return NextResponse.json({ task: updated }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/approve', err);
  }
}
