import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { gitStatusSummary } from '@/lib/agent/git';
import { errorResponse } from '../../../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/:id/git — repository state for the Git rail.
 *
 * Read-only. `git_status`/`git_commit` events feed the activity timeline; this
 * endpoint feeds the governance rail on load and on refresh, so the rail does
 * not depend on an event having been emitted in the current browser session.
 *
 * A workspace that is not a repository root yields `{ status: null }` — the
 * rail renders NOTHING rather than inventing a "clean repository" state for a
 * directory with no history (AGENTS.md §16). A missing git binary is the same
 * answer for the same reason: the rail is observational, not load-bearing.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    // The summary spawns a real git process; a tight client loop must not turn
    // the rail into a process factory.
    const limited = rateLimit(
      `gitStatus:${user.id}`,
      RATE_LIMITS.taskMessage.limit,
      RATE_LIMITS.taskMessage.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const status = await gitStatusSummary(params.id, task.project_path);
    return NextResponse.json({ status });
  } catch (err) {
    return errorResponse('tasks/git/status', err);
  }
}
