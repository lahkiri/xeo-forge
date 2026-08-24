import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { buildTaskExport } from '@/lib/agent/export';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/:id/export
 * Download a deterministic ZIP of the task's workspace + manifest.json.
 * Owner-or-admin only. Export is allowed once the task is terminal
 * (completed | failed) so the snapshot is final and immutable.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    if (task.status !== 'completed' && task.status !== 'failed') {
      return NextResponse.json(
        { error: 'Task is not finished; export is available once it completes.' },
        { status: 409 },
      );
    }

    const { filename, zip, fileCount } = await buildTaskExport(task);

    // Reuse the Buffer's underlying bytes as a fresh ArrayBuffer for the Response.
    const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zip.byteLength),
        'X-Artifact-File-Count': String(fileCount),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse('tasks/export', err);
  }
}
