import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, getTaskEvents } from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);
    const events = await getTaskEvents(params.id);
    return NextResponse.json({ task, events });
  } catch (err) {
    return errorResponse('tasks/get', err);
  }
}
