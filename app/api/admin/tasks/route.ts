import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { listAllTasks } from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/tasks — full task list for admin inspection (newest first). */
export async function GET() {
  try {
    await requireAdmin();
    const tasks = await listAllTasks(200);
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse('admin/tasks/list', err);
  }
}
