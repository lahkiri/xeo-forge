import { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import { getTaskById } from '@/lib/db/queries';
import { startPreviewWithStrategy, stopPreview, getPreviewStatus, analyzeProject } from '@/lib/agent/preview';
import { detectEnvVars } from '@/lib/agent/env';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ENV_VARS = 20;
const MAX_ENV_VALUE_LEN = 1000;
const BLOCKED_ENV_KEYS = new Set([
  'DATABASE_URL', 'MODEL_API_KEY', 'MODEL_BASE_URL', 'ROOT_ADMIN_PASSWORD',
  'ROOT_ADMIN_EMAIL', 'COOKIE_SECURE', 'TASK_WORK_DIR',
]);

/**
 * GET  — preview status + env detection (or analyze if ?action=analyze)
 * POST — start preview with agent-driven strategy
 * DELETE — stop preview
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const action = req.nextUrl.searchParams.get('action');
    if (action === 'analyze') {
      const analysis = await analyzeProject(params.id);
      return NextResponse.json({ analysis });
    }

    const status = getPreviewStatus(params.id);
    const envInfo = detectEnvVars(params.id);
    return NextResponse.json({ preview: status, env: envInfo });
  } catch (err) {
    return errorResponse('tasks/preview', err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    if (task.status !== 'completed' && task.status !== 'failed') {
      return NextResponse.json(
        { error: 'Preview is available after task completes.' },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));

    // Agent-driven strategy (all fields optional — defaults derived dynamically)
    const strategy = {
      runtime: (body.runtime || 'static') as 'static' | 'node' | 'python' | 'custom',
      entryFile: body.entryFile ? String(body.entryFile) : undefined,
      buildCommand: body.buildCommand ? String(body.buildCommand) : undefined,
      startCommand: body.startCommand ? String(body.startCommand) : undefined,
      port: typeof body.port === 'number' ? body.port : undefined,
      ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
      serveRoot: body.serveRoot ? String(body.serveRoot) : undefined,
    };

    // Validate and filter env vars
    const rawEnv: Record<string, string> = body.envVars || {};
    const envKeys = Object.keys(rawEnv);
    if (envKeys.length > MAX_ENV_VARS) {
      return NextResponse.json({ error: `Too many env vars (max ${MAX_ENV_VARS})` }, { status: 400 });
    }
    const envVars: Record<string, string> = {};
    for (const key of envKeys) {
      if (BLOCKED_ENV_KEYS.has(key)) continue;
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
      envVars[key] = String(rawEnv[key]).slice(0, MAX_ENV_VALUE_LEN);
    }

    const result = await startPreviewWithStrategy(params.id, strategy, envVars);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, strategy: result.strategy, readiness: result.readiness }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse('tasks/preview/start', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    assertOwnerOrAdmin(user, task.user_id);

    const stopped = stopPreview(params.id);
    return NextResponse.json({ ok: true, stopped });
  } catch (err) {
    return errorResponse('tasks/preview/stop', err);
  }
}
