import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import { createTask, appendTaskEvent, getTaskById, getTasksByUser } from '@/lib/db/queries';
import { GOLDEN_RUN } from '@/lib/demo/golden-run';
import { errorResponse } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO_GOAL_PREFIX = '[Recorded demo]';
/** Reuse an existing finished demo instead of piling duplicates into the sidebar. */

/**
 * POST /api/demo — seed the golden demo run as a REAL task in this user's
 * history and return its id. The Work surface then navigates to
 * /work/:id?demo=1 where WorkClient paces the visual reveal client-side.
 *
 * Honesty contract: the task goal carries a "[Recorded demo]" prefix and
 * nothing here pretends to be a live model run; the UI labels it too.
 * Desktop Local only today: the demo targets the first-open experience.
 */
export async function POST(_req: NextRequest) {
  try {
    if (!isDesktopLocalMode()) {
      return NextResponse.json({ error: 'Demo replay is available in Desktop Local mode.' }, { status: 403 });
    }
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    // Reuse the newest completed demo when one exists (bounded sidebar churn).
    const mine = await getTasksByUser(user.id);
    // A demo task keeps status 'pending' forever - its lifecycle lives in the
    // event stream, so any prior demo qualifies for reuse.
    const priorDemo = mine.find((t) => t.goal.startsWith(DEMO_GOAL_PREFIX));
    if (priorDemo) {
      return NextResponse.json({ task: priorDemo, reused: true }, { status: 200 });
    }

    const task = await createTask({
      userId: user.id,
      goal: `${DEMO_GOAL_PREFIX} Add a multiply(a, b) helper to src/calc.py with a pytest case, then run the suite.`,
      mode: 'planning',
      status: 'pending',
      intentKind: 'explicit_plan',
    });

    for (const ev of GOLDEN_RUN) {
      await appendTaskEvent(task.id, ev.type, ev.content);
    }

    const seeded = await getTaskById(task.id);
    return NextResponse.json({ task: seeded, reused: false }, { status: 201 });
  } catch (err) {
    return errorResponse('demo/seed', err);
  }
}
