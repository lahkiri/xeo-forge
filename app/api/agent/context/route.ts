import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import {
  createAgentInstruction,
  createAgentMemory,
  deleteAgentInstruction,
  deleteAgentMemory,
  getTaskById,
  listAgentInstructions,
  listAgentMemories,
  updateAgentInstruction,
  updateAgentMemory,
} from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ScopeSchema = z.enum(['global', 'task']);
const KindSchema = z.enum(['preference', 'fact', 'decision', 'constraint', 'lesson']);

const CreateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('instruction'),
    scope: ScopeSchema.default('global'),
    taskId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(5000),
    priority: z.number().int().min(0).max(1000).optional(),
  }),
  z.object({
    type: z.literal('memory'),
    scope: ScopeSchema.default('global'),
    taskId: z.string().uuid().nullable().optional(),
    kind: KindSchema.default('lesson'),
    content: z.string().trim().min(1).max(1200),
    status: z.enum(['proposed', 'active', 'archived']).default('active'),
    confidence: z.number().min(0).max(1).default(1),
    pinned: z.boolean().default(true),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
]);

const UpdateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('instruction'),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(5000).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('memory'),
    id: z.string().uuid(),
    content: z.string().trim().min(1).max(1200).optional(),
    kind: KindSchema.optional(),
    status: z.enum(['proposed', 'active', 'archived']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    pinned: z.boolean().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
]);

const DeleteSchema = z.object({
  type: z.enum(['instruction', 'memory']),
  id: z.string().uuid(),
});

async function assertTaskAccess(user: Awaited<ReturnType<typeof requireUser>>, taskId?: string | null): Promise<void> {
  if (!taskId) return;
  const task = await getTaskById(taskId);
  if (!task) throw new Error('Task not found');
  assertOwnerOrAdmin(user, task.user_id);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const taskId = new URL(req.url).searchParams.get('taskId');
    await assertTaskAccess(user, taskId);
    const [instructions, memories] = await Promise.all([
      listAgentInstructions({ userId: user.id, taskId, includeDisabled: true }),
      listAgentMemories({ userId: user.id, taskId, includeArchived: true }),
    ]);
    return NextResponse.json({ instructions, memories });
  } catch (err) {
    return errorResponse('agent/context/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid context payload.' }, { status: 400 });
    const input = parsed.data;
    const taskId = input.taskId ?? null;
    if (input.scope === 'task' && !taskId) {
      return NextResponse.json({ error: 'Task-scoped context requires taskId.' }, { status: 400 });
    }
    await assertTaskAccess(user, taskId);
    if (input.type === 'instruction') {
      const instruction = await createAgentInstruction({
        userId: user.id,
        taskId,
        scope: input.scope,
        name: input.name,
        content: input.content,
        priority: input.priority,
      });
      return NextResponse.json({ instruction }, { status: 201 });
    }
    const memory = await createAgentMemory({
      userId: user.id,
      taskId,
      scope: input.scope,
      kind: input.kind,
      content: input.content,
      status: input.status,
      confidence: input.confidence,
      pinned: input.pinned,
      expiresAt: input.expiresAt,
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    return errorResponse('agent/context/create', err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid context update.' }, { status: 400 });
    const input = parsed.data;
    const result = input.type === 'instruction'
      ? await updateAgentInstruction(input.id, user.id, {
          name: input.name,
          content: input.content,
          priority: input.priority,
          enabled: input.enabled === undefined ? undefined : (input.enabled ? 1 : 0),
        })
      : await updateAgentMemory(input.id, user.id, {
          content: input.content,
          kind: input.kind,
          status: input.status,
          confidence: input.confidence,
          pinned: input.pinned === undefined ? undefined : (input.pinned ? 1 : 0),
          expires_at: input.expiresAt,
        });
    if (!result) return NextResponse.json({ error: 'Context item not found.' }, { status: 404 });
    return NextResponse.json(input.type === 'instruction' ? { instruction: result } : { memory: result });
  } catch (err) {
    return errorResponse('agent/context/update', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid context deletion.' }, { status: 400 });
    const removed = parsed.data.type === 'instruction'
      ? await deleteAgentInstruction(parsed.data.id, user.id)
      : await deleteAgentMemory(parsed.data.id, user.id);
    if (!removed) return NextResponse.json({ error: 'Context item not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('agent/context/delete', err);
  }
}
