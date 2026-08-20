import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { describeEffectiveContext } from '@/lib/agent/context-pack';
import { AGENT_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT } from '@/lib/agent/prompts';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Context Inspector — report the effective context for a task.
 *
 * Reads the SAME resolution pass the agent loop uses (`resolveContext`), so the
 * inspector cannot claim something the model did not receive. It reports every
 * layer that was considered, whether it was injected, and why.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    // Mode decides the base prompt, so the inspector must match the mode the
    // next run would use.
    const baseSystemPrompt = task.mode === 'planning' ? PLANNING_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;

    const effective = await describeEffectiveContext({
      userId: task.user_id,
      taskId: task.id,
      baseSystemPrompt,
    });

    return NextResponse.json({
      mode: task.mode,
      layers: effective.layers,
      totals: effective.totals,
    });
  } catch (err) {
    return errorResponse('tasks/context/inspect', err);
  }
}
