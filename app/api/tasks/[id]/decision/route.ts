import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { appendTaskEvent, getTaskById, resolveTaskDecision } from '@/lib/db/queries';
import { directExecutionBrief } from '@/lib/agent/intent';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DecisionSchema = z.object({
  choice: z.enum(['direct', 'plan']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task || task.user_id !== user.id) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }
    if (task.status !== 'awaiting_decision' || task.decision_state !== 'pending') {
      return NextResponse.json({ error: 'This Work decision is no longer pending.', task }, { status: 409 });
    }

    const parsed = DecisionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Choose direct execution or planning first.' }, { status: 400 });
    }

    const choice = parsed.data.choice;
    const resolution = await resolveTaskDecision(
      task.id,
      choice,
      choice === 'direct' ? directExecutionBrief(task.goal) : null,
    );

    if (resolution.outcome === 'not_found') {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }
    if (resolution.outcome === 'expired') {
      return NextResponse.json({ error: 'The 30-second decision window expired. Send a new request to choose again.', task: resolution.task }, { status: 409 });
    }
    if (resolution.outcome === 'already_resolved') {
      return NextResponse.json({ error: 'This decision was already resolved.', task: resolution.task }, { status: 409 });
    }
    if (resolution.outcome !== 'resolved') {
      return NextResponse.json({ error: 'This decision could not be resolved.' }, { status: 409 });
    }

    const resolvedTask = resolution.task;
    await appendTaskEvent(resolvedTask.id, 'intent', {
      kind: resolvedTask.intent_kind,
      decision: choice,
      decision_state: resolvedTask.decision_state,
      resolved_at: new Date().toISOString(),
    });

    startAgentRun({
      taskId: resolvedTask.id,
      userId: resolvedTask.user_id,
      goal: resolvedTask.goal,
      mode: resolvedTask.mode,
      projectPath: resolvedTask.project_path,
      approvedPlan: resolvedTask.approved_plan,
      autonomyLevel: resolvedTask.autonomy_level,
    });

    return NextResponse.json({ task: resolvedTask, decision: { choice } });
  } catch (err) {
    return errorResponse('tasks/decision', err);
  }
}
