import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, listAgentMemories, updateAgentMemory, deleteAgentMemory } from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Memory candidate decisions.
 *
 * A candidate is persisted as `status='proposed'` by the agent at completion and
 * is NEVER injected into a run (getActiveAgentMemories filters on
 * status='active'). This route is the only path from proposed to approved, and
 * it requires an explicit user action — there is no auto-approval.
 */
const DecisionSchema = z.object({
  decision: z.enum(['keep', 'reject']),
  /** Optional edit applied at approval time. */
  content: z.string().trim().min(1).max(1200).optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const memories = await listAgentMemories({ userId: task.user_id, taskId: task.id, includeArchived: true });
    return NextResponse.json({
      candidates: memories.filter((memory) => memory.status === 'proposed'),
      approved: memories.filter((memory) => memory.status === 'active'),
    });
  } catch (err) {
    return errorResponse('tasks/memory/list', err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const body = await req.json();
    const memoryId = typeof body?.memoryId === 'string' ? body.memoryId : '';
    if (!memoryId) return NextResponse.json({ error: 'memoryId is required.' }, { status: 400 });

    const parsed = DecisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'decision must be "keep" or "reject".' }, { status: 400 });
    }

    const memories = await listAgentMemories({ userId: task.user_id, taskId: task.id, includeArchived: true });
    const candidate = memories.find((memory) => memory.id === memoryId);
    if (!candidate) return NextResponse.json({ error: 'Memory candidate not found.' }, { status: 404 });
    if (candidate.status !== 'proposed') {
      // Idempotency: a second click must not silently re-approve or re-archive.
      return NextResponse.json({ error: `This memory was already ${candidate.status}.` }, { status: 409 });
    }

    const { decision, content, pinned, expiresAt } = parsed.data;
    const updated = await updateAgentMemory(memoryId, task.user_id, {
      status: decision === 'keep' ? 'active' : 'archived',
      content: content ?? undefined,
      pinned: decision === 'keep' ? (pinned ?? true ? 1 : 0) : 0,
      expires_at: expiresAt === undefined ? undefined : expiresAt,
    });
    if (!updated) return NextResponse.json({ error: 'Could not record the decision.' }, { status: 404 });

    // Approval and rejection are both auditable — the memory contract requires
    // that nothing enters run context without a recorded user decision.
    await emitTaskEvent(task.id, 'memory_decision', {
      memory_id: updated.id,
      decision,
      status: updated.status,
      scope: updated.scope,
      kind: updated.kind,
      edited: Boolean(content && content !== candidate.content),
    });

    return NextResponse.json({ memory: updated });
  } catch (err) {
    return errorResponse('tasks/memory/decision', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const memoryId = new URL(req.url).searchParams.get('memoryId');
    if (!memoryId) return NextResponse.json({ error: 'memoryId is required.' }, { status: 400 });

    const removed = await deleteAgentMemory(memoryId, task.user_id);
    if (!removed) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 });

    await emitTaskEvent(task.id, 'memory_decision', { memory_id: memoryId, decision: 'deleted' });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('tasks/memory/delete', err);
  }
}
