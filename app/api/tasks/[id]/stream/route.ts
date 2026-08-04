import { NextRequest } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById, getTaskEvents } from '@/lib/db/queries';
import { subscribeTask } from '@/lib/sse/emitter';
import type { TaskEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15000;
const SAFETY_TIMEOUT_MS = 30 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const task = await getTaskById(params.id);
  if (!task) {
    return new Response('Task not found', { status: 404 });
  }
  assertOwnerOrAdmin(user, task.user_id);

  const taskId = params.id;
  const encoder = new TextEncoder();

  // Honor the SSE reconnect cursor: on auto-reconnect the browser sends the
  // last seq it received via Last-Event-ID, so we replay only seq > that.
  // The client also dedups by seq, so this is purely an optimization, never
  // a correctness dependency (DB remains the single source of truth).
  const lastEventId = Number(req.headers.get('last-event-id'));
  const initialMaxSeq = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let maxSeq = initialMaxSeq;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let safety: ReturnType<typeof setTimeout> | undefined;

      // Wire contract: `data` carries the event PAYLOAD (the parsed
      // task_events.content), identical to what the initial page load parses
      // from event.content. seq travels in the `id:` field, type in `event:`.
      // (Sending the whole DB row here was the bug behind "undefined events":
      // the client read payload fields off the outer row instead.)
      const send = (row: TaskEvent) => {
        if (closed) return;
        const payload = `id: ${row.seq}\nevent: ${row.type}\ndata: ${row.content}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // 1. Subscribe FIRST and buffer live events so nothing is lost during the
      //    DB replay below. We dedup strictly by seq (single delivery path).
      const liveBuffer: TaskEvent[] = [];
      let replaying = true;
      const unsubscribe = subscribeTask(taskId, (row) => {
        if (replaying) {
          liveBuffer.push(row);
        } else if (row.seq > maxSeq) {
          maxSeq = row.seq;
          send(row);
        }
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        if (safety) clearTimeout(safety);
        try {
          controller.close();
        } catch {
          // Controller may already be closed by the platform; nothing to do.
        }
      };

      // 2. Replay everything already persisted, in seq order.
      try {
        const past = await getTaskEvents(taskId);
        for (const row of past) {
          if (row.seq > maxSeq) {
            maxSeq = row.seq;
            send(row);
          }
        }
      } catch (err) {
        console.error(`[stream] replay failed task=${taskId}:`, err);
      }

      // 3. Flush any live events captured during replay, skipping duplicates.
      replaying = false;
      for (const row of liveBuffer) {
        if (row.seq > maxSeq) {
          maxSeq = row.seq;
          send(row);
        }
      }

      // If the task already finished before we connected, close after replay.
      if (task.status === 'completed' || task.status === 'failed') {
        // Give the flush above a tick, then close.
        cleanup();
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, HEARTBEAT_MS);

      safety = setTimeout(cleanup, SAFETY_TIMEOUT_MS);

      req.signal.addEventListener('abort', cleanup);
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
}
