import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { workspaceFor } from '@/lib/agent/files';
import { errorResponse } from '../../../_lib/respond';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.cache']);
const MAX_DEPTH = 12;

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
  truncated?: boolean; // true when depth limit prevents loading children
}

async function buildTree(dir: string, rel: string, depth: number): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await buildTree(path.join(dir, e.name), childRel, depth + 1);
      nodes.push({ name: e.name, path: childRel, type: 'dir', children, truncated: depth + 1 > MAX_DEPTH });
    } else {
      try {
        const stat = await fsp.stat(path.join(dir, e.name));
        nodes.push({ name: e.name, path: childRel, type: 'file', size: stat.size });
      } catch {
        nodes.push({ name: e.name, path: childRel, type: 'file' });
      }
    }
  }
  // Sort: dirs first, then alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

/** Fast recursive count — no tree structure, no sorting, just totals. */
async function countWorkspace(dir: string): Promise<{ totalFiles: number; totalSize: number }> {
  let totalFiles = 0;
  let totalSize = 0;
  const walk = async (d: string) => {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    const children: Promise<void>[] = [];
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        children.push(walk(path.join(d, e.name)));
      } else {
        totalFiles++;
        try {
          const stat = await fsp.stat(path.join(d, e.name));
          totalSize += stat.size;
        } catch { /* ignore */ }
      }
    }
    await Promise.all(children);
  };
  await walk(dir);
  return { totalFiles, totalSize };
}

/**
 * GET /api/tasks/:id/workspace?path=<subdir>
 * Returns the file tree for the task workspace.
 * Without ?path: returns only top-level entries (depth 1) for fast initial load.
 * With ?path=src/components: returns children of that directory (lazy load).
 * Always returns totalFiles + totalSize for the FULL workspace.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const root = workspaceFor(params.id);
    if (!fs.existsSync(root)) {
      return NextResponse.json({ tree: [], totalFiles: 0, totalSize: 0 });
    }

    const subdir = req.nextUrl.searchParams.get('path') || '';

    let tree: FileNode[];
    if (subdir) {
      // Lazy load: use resolveWithin for path-safety (defeats traversal + symlink escapes)
      let absRoot: string;
      try {
        const { resolveWithin } = await import('@/lib/agent/files');
        absRoot = resolveWithin(root, subdir);
      } catch {
        return NextResponse.json({ tree: [], totalFiles: 0, totalSize: 0 });
      }
      if (!fs.existsSync(absRoot)) {
        return NextResponse.json({ tree: [], totalFiles: 0, totalSize: 0 });
      }
      tree = await buildTree(absRoot, subdir, 0);
    } else {
      // Initial load: return top-level entries only (depth 1, fast)
      tree = await buildTree(root, '', 1);
    }

    // Fast total count (parallel recursive walk, no tree construction)
    const { totalFiles, totalSize } = await countWorkspace(root);

    return NextResponse.json({ tree, totalFiles, totalSize });
  } catch (err) {
    return errorResponse('tasks/workspace', err);
  }
}
