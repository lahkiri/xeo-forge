import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { runGitOp, GitBlockedError, GitError } from '@/lib/agent/git';
import { AccessDeniedError } from '@/lib/agent/files';
import { errorResponse } from '../../../../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../../../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/:id/git/diff[?path=...] — unified diff of the task workspace,
 * rendered by the same DiffView that shows agent git_op diff results.
 *
 * This is the READ half of the git vocabulary: `diff` is in GIT_READ_OPS, so it
 * is available in every mode and cannot mutate anything. Mutating ops remain
 * reachable only through the governed agent loop.
 *
 * `path` is optional. When given it goes through the same resolveWithin
 * path-safety primitive every git pathspec uses — an absolute or traversing
 * path is refused by runGitOp itself, not re-validated here (one primitive,
 * AGENTS.md rule: no duplicate path logic).
 *
 * Not-a-repo and blocked outcomes return 200 with `{ diff: null, blocked }`:
 * they are honest answers the UI renders, not server failures. The rail and
 * the Diff tab must be able to say WHY there is nothing to show.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    // One diff = one git process pair (rev-parse + diff); keep an abusive
    // client from using the endpoint as a fork bomb against its own repo.
    const limited = rateLimit(
      `gitDiff:${user.id}`,
      RATE_LIMITS.taskMessage.limit,
      RATE_LIMITS.taskMessage.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const rawPath = req.nextUrl.searchParams.get('path');
    const paths = rawPath && rawPath.trim().length > 0 ? [rawPath.trim()] : [];

    try {
      const diff = await runGitOp(params.id, task.project_path, task.mode, { op: 'diff', paths });
      return NextResponse.json({ diff, blocked: null });
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        // A path that escapes the workspace (traversal, absolute, symlink).
        // Same honest "blocked" answer as not-a-repo — it is a refusal, not a
        // server failure, and the UI must be able to show why.
        return NextResponse.json({ diff: null, blocked: err.message });
      }
      if (err instanceof GitBlockedError) {
        return NextResponse.json({ diff: null, blocked: err.message });
      }
      if (err instanceof GitError) {
        // git ran and failed (missing binary, timeout). The reason is safe to
        // surface — it is our own bounded message, not raw stderr passthrough
        // beyond what git.ts already capped and framed.
        return NextResponse.json({ diff: null, blocked: err.message });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse('tasks/git/diff', err);
  }
}
