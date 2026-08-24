import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { workspaceFor, resolveWithin } from '@/lib/agent/files';
import { errorResponse } from '../../../../_lib/respond';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_READ = 1024 * 1024; // 1MB

/**
 * GET /api/tasks/:id/workspace/[...path]
 * Read a single file from the task workspace. Returns content + metadata.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; path: string[] } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const relPath = params.path.join('/');
    const root = workspaceFor(params.id);
    if (!fs.existsSync(root)) {
      return NextResponse.json({ error: 'Workspace empty' }, { status: 404 });
    }

    let abs: string;
    try {
      abs = resolveWithin(root, relPath);
    } catch {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(abs)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Is a directory' }, { status: 400 });
    }
    if (stat.size > MAX_READ) {
      return NextResponse.json({ error: `File too large (${stat.size} bytes)` }, { status: 400 });
    }

    const content = fs.readFileSync(abs, 'utf8');
    return NextResponse.json({
      path: relPath,
      content,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    });
  } catch (err) {
    return errorResponse('tasks/workspace/file', err);
  }
}
