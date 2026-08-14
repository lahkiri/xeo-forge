import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { getPreviewPort } from '@/lib/agent/preview';
import { errorResponse } from '@/app/api/_lib/respond';
import { shouldForwardPreviewResponseHeader } from '@/lib/agent/preview-headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin authenticated proxy to a running, HTTP-verified preview server.
 *
 * The preview server binds 127.0.0.1 ON THE HOST. The user's browser cannot
 * reach that loopback address directly (that was the connection-refused bug).
 * This route lets the browser load the preview through the Next.js app itself
 * (same origin), gated by the same owner-or-admin authz as every task route.
 *
 * It is NOT a new preview layer: it owns no lifecycle, no readiness, no state.
 * It only forwards a request to a port that getPreviewPort() has already
 * confirmed belongs to a verified-ready, non-expired preview. If the preview
 * is not ready/running, there is no port to proxy and this returns 409.
 */
async function handle(req: NextRequest, taskId: string, pathParts: string[]) {
  const user = await requireUser();
  const task = await getTaskById(taskId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  assertOwnerOrAdmin(user, task.user_id);

  const port = getPreviewPort(taskId);
  if (port == null) {
    return NextResponse.json(
      { error: 'No verified preview is running for this task.' },
      { status: 409 },
    );
  }

  const subPath = pathParts.map(encodeURIComponent).join('/');
  const search = req.nextUrl.search || '';
  const target = `http://127.0.0.1:${port}/${subPath}${search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: { accept: req.headers.get('accept') || '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // Connection refused / timeout / server gone — never mask as success.
    console.error(`[api] tasks/preview/proxy: upstream fetch failed for task ${taskId}:`, err);
    return NextResponse.json(
      { error: 'Preview server is not reachable.' },
      { status: 502 },
    );
  }

  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (shouldForwardPreviewResponseHeader(key)) headers.set(key, value);
  });
  // Allow same-origin framing by our own app.
  headers.set('Content-Security-Policy', "frame-ancestors 'self'");

  return new NextResponse(body, { status: upstream.status, headers });
}

export async function GET(req: NextRequest, { params }: { params: { id: string; path?: string[] } }) {
  try {
    return await handle(req, params.id, params.path || []);
  } catch (err) {
    return errorResponse('tasks/preview/proxy', err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string; path?: string[] } }) {
  try {
    return await handle(req, params.id, params.path || []);
  } catch (err) {
    return errorResponse('tasks/preview/proxy', err);
  }
}
