import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, switchTaskMode } from '@/lib/db/queries';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ModeSchema = z.object({
  mode: z.enum(['planning', 'build']),
});

/**
 * Switch a task's mode. Preserves conversation history and execution state.
 *
 * Switching to planning: clears approved_plan, resets to pending so a new
 * planning run starts automatically (user can then revise and re-approve).
 *
 * Switching to build: only useful from non-running states; the task continues
 * with its existing approved_plan if one exists.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const body = await req.json();
    const parsed = ModeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'mode must be "planning" or "build"' }, { status: 400 });
    }

    const targetMode = parsed.data.mode;
    if (task.mode === targetMode && task.status !== 'completed' && task.status !== 'failed') {
      return NextResponse.json({ error: `Already in ${targetMode} mode.` }, { status: 409 });
    }

    const ok = await switchTaskMode(params.id, targetMode);
    if (!ok) {
      return NextResponse.json(
        { error: 'Task is running or pending — cannot switch mode right now.' },
        { status: 409 },
      );
    }

    const updated = await getTaskById(params.id);
    if (!updated) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // If switching to planning, automatically start a new planning run so the
    // user sees the agent inspect and produce a revised plan.
    if (targetMode === 'planning') {
      startAgentRun({
        taskId: updated.id,
        userId: task.user_id,
        goal: updated.goal,
        mode: 'planning',
      });
    }

    return NextResponse.json({ task: updated }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/mode', err);
  }
}
