import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, appendMessage, claimTaskForFollowUp, updateTaskStatus } from '@/lib/db/queries';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../../../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MessageSchema = z.object({
  content: z.string().min(1).max(20000),
});

/**
 * Send a follow-up message in an existing task session.
 *
 * Persists the user message, then starts a new agent run with the full
 * conversation history injected into context. Only allowed on terminal or
 * approval-waiting tasks (completed, failed, or planned).
 *
 * The agent run streams back via SSE on the same task channel — the client
 * already listens for all event types.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    // Checked before the task lookup so a hammered endpoint does not cost a DB
    // read per refused call. Each accepted message can resume an agent run, so
    // the ceiling here is about provider spend and host work, not just traffic.
    const limited = rateLimit(
      `taskMessage:${user.id}`,
      RATE_LIMITS.taskMessage.limit,
      RATE_LIMITS.taskMessage.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }
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

    // Claim the task before appending the message. The conditional UPDATE is
    // the concurrency gate: exactly one request can transition a terminal or
    // planned task to pending and therefore start a new runner.
    const claimed = await claimTaskForFollowUp(params.id);
    if (!claimed) {
      return NextResponse.json(
        { error: 'The task is already running or was claimed by another request.' },
        { status: 409 },
      );
    }

    try {
      await appendMessage(params.id, 'user', parsed.data.content);
    } catch (err) {
      // Do not leave a claimed task silently stuck in pending if persistence of
      // the user message fails.
      await updateTaskStatus(params.id, 'failed', {
        error: 'Failed to persist follow-up message before starting the agent.',
      }).catch((rollbackErr) => console.error('[tasks/message] failed to record message error', rollbackErr));
      throw err;
    }

    // Start a new agent run with the full conversation history.
    startAgentRun({
      taskId: claimed.id,
      userId: claimed.user_id,
      goal: claimed.goal,
      mode: claimed.mode,
      projectPath: claimed.project_path,
      approvedPlan: claimed.mode === 'build' ? claimed.approved_plan : undefined,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/message', err);
  }
}
