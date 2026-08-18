import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { getTasksByUser, createTask, updateTaskStatus, appendMessage } from '@/lib/db/queries';
import { tryDebit } from '@/lib/credits/engine';
import { TASK_CREATE_COST } from '@/lib/credits/pricing';
import { startAgentRun } from '@/lib/agent/runner';
import { errorResponse } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateTaskSchema = z.object({
  goal: z.string().min(1).max(20000),
  mode: z.enum(['chat', 'planning', 'build']).optional(),
  projectPath: z.string().trim().min(1).max(4096).nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  skillId: z.string().uuid().nullable().optional(),
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
    const mode = parsed.data.mode === 'chat' ? 'chat' : 'planning';
    const task = await createTask({
      userId: user.id,
      goal: parsed.data.goal,
      mode,
      projectPath: parsed.data.projectPath,
      profileId: parsed.data.profileId,
      skillId: parsed.data.skillId,
    });

    // Ordinary chat is not a billable SaaS task and must not be blocked by a
    // local credit balance. Planning/build requests retain the explicit budget
    // guard until a cloud usage ledger is connected.
    if (mode !== 'chat') {
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
    }

    // Persist the opening turn before returning the task. The runner checks for
    // existing context and will not duplicate it; this also prevents a newly
    // opened thread from rendering as an empty page while the async run starts.
    await appendMessage(task.id, 'user', parsed.data.goal);

    // Fire-and-forget; the runner owns status transitions and failure emission.
    startAgentRun({
      taskId: task.id,
      userId: user.id,
      goal: parsed.data.goal,
      mode,
      projectPath: task.project_path,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return errorResponse('tasks/create', err);
  }
}
