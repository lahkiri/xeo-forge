import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, appendMessage, updateTaskStatus } from '@/lib/db/queries';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MessageSchema = z.object({
  content: z.string().min(1).max(20000),
});

/**
 * Send a follow-up message in an existing task session.
 *
 * Persists the user message, then starts a new agent run with the full
 * conversation history injected into context. Only allowed on non-running
 * tasks (completed, failed, planned, or pending after a prior run).
 *
 * The agent run streams back via SSE on the same task channel — the client
 * already listens for all event types.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    // Cannot send messages while an agent run is active.
    if (task.status === 'running' || task.status === 'pending') {
      return NextResponse.json(
        { error: 'Agent is currently running. Wait for it to finish or switch modes.' },
        { status: 409 },
      );
    }

    const body = await req.json();
    const parsed = MessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Message content is required.' }, { status: 400 });
    }

    // Persist the user message.
    await appendMessage(params.id, 'user', parsed.data.content);

    // Reset task status so the agent run can start.
    // Use task.mode as source of truth (not status heuristic).
    const nextMode = task.mode;
    await updateTaskStatus(params.id, 'pending');

    // Start a new agent run with the full conversation history.
    startAgentRun({
      taskId: params.id,
      userId: task.user_id,
      goal: task.goal,
      mode: nextMode,
      approvedPlan: nextMode === 'build' ? task.approved_plan : undefined,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/message', err);
  }
}
