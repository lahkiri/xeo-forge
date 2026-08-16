import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { getTasksByUser, createTask, updateTaskStatus } from '@/lib/db/queries';
import { tryDebit } from '@/lib/credits/engine';
import { TASK_CREATE_COST } from '@/lib/credits/pricing';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateTaskSchema = z.object({
  goal: z.string().min(1).max(20000),
  mode: z.enum(['planning', 'build']).optional(),
  profileId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const tasks = await getTasksByUser(user.id);
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse('tasks/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'A non-empty goal is required.' }, { status: 400 });
    }
    if (parsed.data.mode === 'build') {
      return NextResponse.json(
        { error: 'New tasks must start in planning mode. Approve the proposed plan to begin the build.' },
        { status: 409 },
      );
    }

    // Every new task starts in planning mode. Build mode is entered only by
    // the atomic approveTaskPlan transition, which freezes approved_plan.
    const mode = 'planning' as const;
    const task = await createTask({ userId: user.id, goal: parsed.data.goal, mode, profileId: parsed.data.profileId });

    // Debit creation cost atomically. If insufficient, mark the task failed so
    // history stays truthful (no orphan pending row) and return 402.
    const debited = await tryDebit(user.id, TASK_CREATE_COST, 'task_create', task.id);
    if (!debited.ok) {
      await updateTaskStatus(task.id, 'failed', {
        error: `Insufficient credits to start task (balance ${debited.balance}, need ${debited.needed}).`,
      });
      return NextResponse.json(
        { error: 'Insufficient credits', balance: debited.balance, needed: debited.needed },
        { status: 402 },
      );
    }

    // Fire-and-forget; the runner owns status transitions and failure emission.
    startAgentRun({ taskId: task.id, userId: user.id, goal: parsed.data.goal, mode });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return errorResponse('tasks/create', err);
  }
}
