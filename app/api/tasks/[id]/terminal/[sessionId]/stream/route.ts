import { NextRequest } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import {
  attachSession,
  scrollbackOf,
  TerminalError,
} from '@/lib/agent/terminal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/:id/terminal/:sessionId/stream — SSE stream of live terminal
 * output. Replays the scrollback buffer on connect, then forwards live chunks.
 *
 * The client sends input via POST to the parent route. This is a read-only
 * stream, which keeps the auth boundary clean: one auth check on connect, one
 * direction of data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return new Response(JSON.stringify({ error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assertOwnerOrAdmin(user, task.user_id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Replay scrollback buffer so a late-joining viewer sees recent history.
        try {
          const scrollback = scrollbackOf(params.sessionId, user.id);
          if (scrollback) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'scrollback', data: scrollback })}\n\n`),
            );
          }
        } catch (err) {
          if (err instanceof TerminalError) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`),
            );
            controller.close();
            return;
          }
          throw err;
        }

        // Subscribe to live output. The session can die between the scrollback
        // replay above and this call (exit race), so the attach is guarded the
        // same way — the client gets an explicit error frame, never a torn
        // stream that fails silently on the browser side.
        let unsub: (() => void) | undefined;
        try {
          unsub = attachSession(
            params.sessionId,
            user.id,
            (chunk: string) => {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'output', data: chunk })}\n\n`),
                );
              } catch {
                // Controller already closed — client disconnected.
              }
            },
            (exitCode: number) => {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'exit', code: exitCode })}\n\n`,
                  ),
                );
                controller.close();
              } catch {
                /* already closed */
              }
            },
          );
        } catch (err) {
          if (err instanceof TerminalError) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`),
            );
            controller.close();
            return;
          }
          throw err;
        }

        // Cleanup on client disconnect.
        req.signal.addEventListener('abort', () => {
          unsub?.();
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    if (err instanceof TerminalError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[terminal/stream]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
